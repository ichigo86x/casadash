// Calendar dates are stored as "YYYY-MM-DD" strings in local time (server TZ, or the browser on the client).
// Date.toISOString() would shift them to UTC, e.g. 00:30 in Rome would still be "yesterday".

export function localDateString(d: Date = new Date()): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

function daysInMonth(year: number, monthIndex: number): number {
	return new Date(year, monthIndex + 1, 0).getDate();
}

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

/**
 * Next occurrence of a recurring date. Monthly and yearly steps clamp to the end of the
 * month instead of overflowing (31 Jan + 1 month = 28/29 Feb, not 3 Mar).
 */
export function nextOccurrence(dateStr: string, frequency: string): string {
	const [y, m, d] = dateStr.split('-').map(Number);
	switch (frequency) {
		case 'daily':
			return localDateString(new Date(y, m - 1, d + 1));
		case 'weekly':
			return localDateString(new Date(y, m - 1, d + 7));
		case 'yearly':
			return localDateString(new Date(y + 1, m - 1, Math.min(d, daysInMonth(y + 1, m - 1))));
		case 'monthly':
		default: {
			const year = m === 12 ? y + 1 : y;
			const monthIndex = m % 12;
			return localDateString(new Date(year, monthIndex, Math.min(d, daysInMonth(year, monthIndex))));
		}
	}
}
