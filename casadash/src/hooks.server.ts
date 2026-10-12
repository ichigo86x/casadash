import { db } from '$lib/server/db';
import { recurringTransactions, transactions, users } from '$lib/server/db/schema';
import { lte, eq, and } from 'drizzle-orm';
import { error, redirect, type Handle, type HandleServerError, type ServerInit } from '@sveltejs/kit';
import { runScheduledBackup } from '$lib/server/backup';
import { SESSION_COOKIE, createSession, purgeExpiredSessions, setAuthCookie, validateSession } from '$lib/server/auth';
import { pushSensorsToHomeAssistant } from '$lib/server/sensors';
import { cookieSecure } from '$lib/server/config';
import { appUrl, ingressBase, ingressHaUser } from '$lib/server/ingress';
import { localDateString, nextOccurrence } from '$lib/dates';

const HOUR = 60 * 60 * 1000;

// Background jobs, independent of page visits: recurring transactions, session cleanup, backups
async function runHourlyTasks() {
    try {
        await processRecurringTransactions();
        await purgeExpiredSessions();
    } catch (e) {
        console.error("[CRON] Errore nell'esecuzione dei task ricorrenti:", e);
    }
    try {
        await runScheduledBackup();
    } catch (e) {
        console.error('[BACKUP] Errore nel backup automatico:', e);
    }
}

export const init: ServerInit = async () => {
    // First run shortly after start-up, then every hour
    setTimeout(runHourlyTasks, 5000).unref();
    setInterval(runHourlyTasks, HOUR).unref();
    // Home Assistant sensors (add-on only): every 10 minutes
    setTimeout(pushSensorsToHomeAssistant, 15000).unref();
    setInterval(pushSensorsToHomeAssistant, 10 * 60 * 1000).unref();
};

// Routes reachable without a session. Static files (/_app, static/) are served before this hook.
function isPublicPath(pathname: string): boolean {
    // /api/sensors checks its own token (Home Assistant `rest` integration)
    return pathname === '/login' || pathname.startsWith('/login/') || pathname === '/api/sensors';
}

export const handle: Handle = async ({ event, resolve }) => {
    event.locals.base = ingressBase(event.request.headers);

    event.locals.haUser = ingressHaUser(event.request.headers, event.locals.base, event.getClientAddress());

    // 1. Resolve Auth Session Context
    let user = await validateSession(event.cookies.get(SESSION_COOKIE), 'session');

    // Automatic sign-in from the Home Assistant sidebar for a linked HA user
    if (!user && event.locals.haUser) {
        const [linked] = await db.select().from(users).where(eq(users.haUserId, event.locals.haUser.id)).limit(1);
        if (linked) {
            setAuthCookie(event.cookies, SESSION_COOKIE, await createSession(linked.id, 'session'), cookieSecure(event.url, event.request.headers));
            user = linked;
        }
    }
    event.locals.user = user
        ? { id: user.id, username: user.username, displayName: user.displayName, mustChangePassword: user.mustChangePassword, role: user.role }
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
        // Backups contain every account's data and password hashes: administrators only
        if (event.locals.user.role !== 'admin' && (pathname.startsWith('/settings/backup') || pathname.startsWith('/api/backup'))) {
            if (pathname.startsWith('/api/')) throw error(403, 'Riservato agli amministratori');
            throw redirect(303, appUrl(event.locals, '/'));
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
            nextDateStr = nextOccurrence(nextDateStr, job.frequency, job.anchorDay);
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
