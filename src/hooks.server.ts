import { db } from '$lib/server/db';
import { recurringTransactions, transactions } from '$lib/server/db/schema';
import { lte, eq, and } from 'drizzle-orm';
import { users } from '$lib/server/db/schema';
import type { Handle, HandleServerError } from '@sveltejs/kit';

let lastRun = 0;

export const handle: Handle = async ({ event, resolve }) => {
    // 1. Resolve Auth Session Context
    const sessionUserId = event.cookies.get('auth_user');
    if (sessionUserId) {
        const uResult = await db.select().from(users).where(eq(users.id, parseInt(sessionUserId))).limit(1);
        if (uResult.length > 0) {
            event.locals.user = uResult[0];
        } else {
            event.locals.user = null;
        }
    } else {
        event.locals.user = null;
    }

    // 2. Perform Automated Tasks checks in Background
    const now = Date.now();
    // Run the automated tasks check at most once per hour to minimize I/O overhead
    if (now - lastRun > 3600000) {
        lastRun = now;
        try {
            await processRecurringTransactions();
        } catch (e) {
            console.error("[CRON] Errore nell'esecuzione dei task ricorrenti:", e);
        }
    }
    
    return resolve(event);
};

async function processRecurringTransactions() {
    const todayStr = new Date().toISOString().split('T')[0];
    
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

        // Automatically inject the transaction as if the user did it themselves
        await db.insert(transactions).values({
            type: job.type,
            amount: job.amount,
            description: job.description,
            category: job.category,
            paymentMethod: job.paymentMethod,
            tags: JSON.stringify(parsedTags),
            date: job.nextDate, // Lock the date to the exact day it was supposed to trigger
            createdBy: job.createdBy
        });
        
        // Advance the calendar for the next billing cycle
        const nextDateObj = new Date(job.nextDate);
        if (job.frequency === 'monthly') {
            nextDateObj.setMonth(nextDateObj.getMonth() + 1);
        } else if (job.frequency === 'yearly') {
            nextDateObj.setFullYear(nextDateObj.getFullYear() + 1);
        } else if (job.frequency === 'weekly') {
            nextDateObj.setDate(nextDateObj.getDate() + 7);
        } else if (job.frequency === 'daily') {
            nextDateObj.setDate(nextDateObj.getDate() + 1);
        }

        const nextDateStr = nextDateObj.toISOString().split('T')[0];
        
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
