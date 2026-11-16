// Password rules, shared by the server and the forms.
export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 128; // bcrypt only looks at the first 72 bytes: longer input adds nothing

const COMMON = new Set([
	'password', 'password1', 'password123', '1234567890', '12345678910', 'qwertyuiop', 'qwerty1234',
	'iloveyou12', 'admin12345', 'administrator', 'casadash123', 'casadash', 'letmein123', 'welcome123',
	'0123456789', 'abcdefghij', 'passw0rd12', 'famiglia123', 'italia2024', 'italia2025', 'italia2026'
]);

/** Returns an error message, or null when the password is acceptable. */
export function passwordProblem(password: string, username = ''): string | null {
	if (password.length < MIN_PASSWORD) return `La password deve contenere almeno ${MIN_PASSWORD} caratteri`;
	if (password.length > MAX_PASSWORD) return `La password non può superare ${MAX_PASSWORD} caratteri`;
	const lower = password.toLowerCase();
	if (COMMON.has(lower)) return 'Password troppo comune: scegline una meno prevedibile';
	if (username && lower.includes(username.toLowerCase()) && username.length >= 3) return 'La password non deve contenere il nome utente';
	if (new Set(password).size < 5) return 'Password troppo semplice: usa caratteri più vari';
	return null;
}
