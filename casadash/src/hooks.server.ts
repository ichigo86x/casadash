import { db } from '$lib/server/db';
import { recurringTransactions, transactions, users } from '$lib/server/db/schema';
import { lte, eq, and } from 'drizzle-orm';
import { error, redirect, type Handle, type HandleServerError, type ServerInit } from '@sveltejs/kit';
import { runScheduledBackup } from '$lib/server/backup';
import { SESSION_COOKIE, createSession, purgeExpiredSessions, setAuthCookie, validateSession } from '$lib/server/auth';
import { pushSensorsToHomeAssistant } from '$lib/server/sensors';
import { cookieSecure, requestIsHttps } from '$lib/server/config';
import { appUrl, ingressBase, ingressHaUser } from '$lib/server/ingress';
import { localDateString, nextOccurrence } from '$lib/dates';
import { isRequestAllowed } from '$lib/server/csrf';
import { encryptLegacyTotpSecrets } from '$lib/server/mfa';
import { pruneAudit } from '$lib/server/audit';
import { removeOrphanReceipts, receiptName } from '$lib/server/receipts';
import { trashedReceipts } from '$lib/server/trash';
import { syncAllBankConnections } from '$lib/server/openbanking';
import { env } from '$env/dynamic/private';

const HOUR = 60 * 60 * 1000;

// Background jobs, independent of page visits: recurring transactions, session cleanup, backups
async function runHourlyTasks() {
    try {
        await processRecurringTransactions();
        await purgeExpiredSessions();
        pruneAudit();
        await cleanupReceipts();
    } catch (e) {
        console.error("[CRON] Errore nell'esecuzione dei task ricorrenti:", e);
    }
    try {
        await runScheduledBackup();
    } catch (e) {
        console.error('[BACKUP] Errore nel backup automatico:', e);
    }
    try {
        await syncAllBankConnections();
    } catch (e) {
        console.error('[BANCA] Errore nella sincronizzazione:', e);
    }
}

/** Receipt files left behind by deleted or replaced movements (kept while an undo is still possible). */
async function cleanupReceipts() {
    const rows = await db.select({ receipt: transactions.receiptPath }).from(transactions);
    const referenced = await trashedReceipts();
    for (const r of rows) {
        const name = receiptName(r.receipt);
        if (name) referenced.add(name);
    }
    const removed = removeOrphanReceipts(referenced);
    if (removed) console.log(`[CRON] Rimosse ${removed} ricevute non più collegate a movimenti`);
}

export const init: ServerInit = async () => {
    // TOTP secrets saved in clear text by older versions get encrypted
    try { await encryptLegacyTotpSecrets(); } catch (e) { console.error('[MFA] Cifratura dei segreti non riuscita:', e); }
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

// Pages can be embedded only by the same origin (Home Assistant Ingress is same-origin with its own pages).
// Set FRAME_ANCESTORS to a space-separated list to allow e.g. a panel_iframe on another host.
function withSecurityHeaders(response: Response, secure: boolean): Response {
    const h = response.headers;
    try {
        h.set('X-Content-Type-Options', 'nosniff');
        h.set('Referrer-Policy', 'same-origin');
        h.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
        h.set('Cross-Origin-Opener-Policy', 'same-origin');
        if (secure) h.set('Strict-Transport-Security', 'max-age=15552000');
        const csp = h.get('content-security-policy');
        if (csp) h.set('content-security-policy', `${csp}; frame-ancestors ${env.FRAME_ANCESTORS || "'self'"}`);
    } catch {
        // immutable response (e.g. proxied): leave as it is
    }
    return response;
}

export const handle: Handle = async ({ event, resolve }) => {
    // Cross-site form posts and fetches are refused before anything else runs
    if (!isRequestAllowed(event.request.method, event.request.headers, event.url.host)) {
        throw error(403, 'Richiesta da un’origine non consentita. Se usi un proxy, imposta TRUSTED_ORIGINS.');
    }

    event.locals.base = ingressBase(event.request.headers);

    event.locals.haUser = ingressHaUser(event.request.headers, event.locals.base, event.getClientAddress());

    // 1. Resolve Auth Session Context
    let user = await validateSession(event.cookies.get(SESSION_COOKIE), 'session');

    // Automatic sign-in from the Home Assistant sidebar for a linked HA user
    if (!user && event.locals.haUser) {
        const [linked] = await db.select().from(users).where(eq(users.haUserId, event.locals.haUser.id)).limit(1);
        if (linked) {
            const token = await createSession(linked.id, 'session', { ip: event.getClientAddress(), userAgent: event.request.headers.get('user-agent') });
            setAuthCookie(event.cookies, SESSION_COOKIE, token, cookieSecure(event.url, event.request.headers));
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
        // Backups, audit log and bank links contain every account's data: administrators only
        const adminOnly = ['/settings/backup', '/api/backup', '/settings/audit', '/settings/bank'];
        if (event.locals.user.role !== 'admin' && adminOnly.some((p) => pathname.startsWith(p))) {
            if (pathname.startsWith('/api/')) throw error(403, 'Riservato agli amministratori');
            throw redirect(303, appUrl(event.locals, '/'));
        }
    }

    return withSecurityHeaders(await resolve(event), requestIsHttps(event.request.headers));
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
        let parsedTags: string[] = [];
        try { parsedTags = JSON.parse(job.tags || '[]'); } catch (e) {}
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
