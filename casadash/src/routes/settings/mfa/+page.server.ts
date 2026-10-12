import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import * as QRCodeRaw from 'qrcode';
import type { PageServerLoad, Actions } from './$types';
import * as OTPAuth from 'otpauth';

export const load: PageServerLoad = async ({ locals }) => {
    if (!locals.user) return { requireLogin: true };

    const uResult = await db.select().from(users).where(eq(users.id, locals.user.id)).limit(1);
    const hasMfa = !!uResult[0]?.totpSecret;

    let secret = '';
    let qrCodeUrl = '';

    if (!hasMfa) {
        const secretObj = new OTPAuth.Secret({ size: 20 });
        secret = secretObj.base32;
        
        const totp = new OTPAuth.TOTP({
            issuer: 'CasaDash',
            label: uResult[0].username,
            algorithm: 'SHA1',
            digits: 6,
            period: 30,
            secret: secretObj
        });
        
        const uri = totp.toString();
        
        try {
            const QRCode = ((QRCodeRaw as any).default || QRCodeRaw) as typeof QRCodeRaw;
            qrCodeUrl = await QRCode.toDataURL(uri);
        } catch (e) {
            console.error("MFA QR Generation Failed:", e);
        }
    }

    return { hasMfa, qrCodeUrl, secret };
};

export const actions: Actions = {
    enable: async ({ request, locals }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });
        
        const data = await request.formData();
        const secret = data.get('secret')?.toString();
        let code = data.get('code')?.toString();

        if (!secret || !code) return fail(400, { error: 'Dati mancanti' });

        code = code.replace(/\s+/g, '');

        const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
        const isValid = totp.validate({ token: code, window: 1 }) !== null;
        
        if (!isValid) return fail(400, { error: 'Codice errato. Riprova.' });

        // Save secret to DB unconditionally since it's verified
        try {
            await db.update(users).set({ totpSecret: secret }).where(eq(users.id, locals.user.id));
            return { success: true };
        } catch(e) {
            return fail(500, { error: 'Errore interno nel salvare l\'MFA' });
        }
    },
    disable: async ({ locals }) => {
        if (!locals.user) return fail(401, { error: 'Non autorizzato' });
        await db.update(users).set({ totpSecret: null }).where(eq(users.id, locals.user.id));
        return { success: true };
    }
};
