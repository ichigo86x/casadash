import { db } from '$lib/server/db';
import { recurringTransactions, transactions } from '$lib/server/db/schema';
import { lte, eq, and } from 'drizzle-orm';
import { error, redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { SESSION_COOKIE, purgeExpiredSessions, validateSession } from '$lib/server/auth';
import { appUrl, ingressBase } from '$lib/server/ingress';
import { localDateString, nextOccurrence } from '$lib/dates';

let lastRun = 0;

// Routes reachable without a session. Static files (/_app, static/) are served before this hook.
function isPublicPath(pathname: string): boolean {
    return pathname === '/login' || pathname.startsWith('/login/');
}

export const handle: Handle = async ({ event, resolve }) => {
    event.locals.base = ingressBase(event.request.headers);

    // 1. Resolve Auth Session Context
    const user = await validateSession(event.cookies.get(SESSION_COOKIE), 'session');
    event.locals.user = user
        ? { id: user.id, username: user.username, displayName: user.displayName, mustChangePassword: user.mustChangePassword }
        : null;

    // 2. Every route except the login page requires a session
    const { pathname } = event.url;
    if (!isPublicPath(pathname)) {
        if (!event.locals.user) {
            if (pathname.startsWith('/api/') || pathname.startsWith('/uploads/')) throw error(401, 'Non autorizzato');
            throw redirect(303, appUrl(event.locals, '/login'));
        }
        // Accounts with a default or admin-assigned password must set their own first
        if (event.locals.user.mustChangePassword && pathname !== '/settings/profile') {
            throw redirect(303, appUrl(event.locals, '/settings/profile'));
        }
    }

    // 3. Perform Automated Tasks checks in Background
    const now = Date.now();
    // Run the automated tasks check at most once per hour to minimize I/O overhead
    if (now - lastRun > 3600000) {
        lastRun = now;
        try {
            await processRecurringTransactions();
            await purgeExpiredSessions();
        } catch (e) {
            console.error("[CRON] Errore nell'esecuzione dei task ricorrenti:", e);
        }
    }

    return resolve(event);
};

async function processRecurringTransactions() {
    const todayStr = localDateString();
    
    // Find all active subscriptions and recurring tasks whose nextDate has arrived or already passed
    const dueJobs = await db.select().from(recurringTransactions).where(
        and(lte(recurringTransactions.nextDate, todayStr), eq(recurringTransactions.isActive, 1))
    );
    
    if (dueJobs.length > 0) {
        console.log(`[CRON] Trovati ${dueJobs.length} task ricorrenti in sospeso. Esecuzione in corso...`);
    }

    for (const job of dueJobs) {
        let parsedTags = [];
        try { parsedTags = JSON.parse(job.tags || '[]'); } catch(e) {}
        if (!parsedTags.includes('Ricorrente')) parsedTags.push('Ricorrente');

        // Catch up on every missed occurrence (e.g. the server was off for weeks),
        // bounded so a corrupted date can never loop forever
        let nextDateStr = job.nextDate;
        for (let i = 0; i < 1000 && nextDateStr <= todayStr; i++) {
            // Automatically inject the transaction as if the user did it themselves
            await db.insert(transactions).values({
                type: job.type,
                amount: job.amount,
                description: job.description,
                category: job.category,
                paymentMethod: job.paymentMethod,
                tags: JSON.stringify(parsedTags),
                date: nextDateStr, // Lock the date to the exact day it was supposed to trigger
                createdBy: job.createdBy
            });
            // Advance the calendar for the next billing cycle
            nextDateStr = nextOccurrence(nextDateStr, job.frequency);
        }
        
        // Save the new date for the next automated iteration
        await db.update(recurringTransactions).set({ nextDate: nextDateStr }).where(eq(recurringTransactions.id, job.id));
        console.log(`[CRON] Processato task #${job.id} (${job.description}). Prossima esecuzione: ${nextDateStr}`);
    }
}

export const handleError: HandleServerError = ({ error }) => {
    console.error('[UNHANDLED SERVER ERROR]', error);
    return {
        message: 'Si è verificato un errore interno. Contatta l\'amministratore se il problema persiste o visualizza i log.'
    };
};
