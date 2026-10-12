import { error, json } from '@sveltejs/kit';
import { checkSensorToken, sensorJson } from '$lib/server/sensors';

// Read-only figures for Home Assistant's `rest` integration.
// Reachable without a session (see hooks.server.ts) but only with the token created in Dati.
// The token travels only in the Authorization header, never in the URL (URLs end up in logs).
export const GET = async ({ request }) => {
    const header = request.headers.get('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!(await checkSensorToken(token))) throw error(401, 'Token non valido');
    return json(await sensorJson(), { headers: { 'Cache-Control': 'no-store' } });
};
