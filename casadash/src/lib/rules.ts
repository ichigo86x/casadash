// Automatic categorisation rules, shared by the server (import, "apply to existing")
// and the browser (new transaction form).

export type Rule = {
	id: number;
	pattern: string;
	type: 'any' | 'expense' | 'income';
	category: string | null;
	addTags: string;
	markTransfer: number;
	priority: number;
	isActive: number;
};

/** Lowercase, no accents, single spaces: "Pagamento  POS Esselunga" ~ "pagamento pos esselunga". */
export function normalizeText(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

export function ruleTags(rule: Pick<Rule, 'addTags'>): string[] {
	try {
		const tags = JSON.parse(rule.addTags || '[]');
		return Array.isArray(tags) ? tags.map(String) : [];
	} catch {
		return [];
	}
}

/** First active rule whose pattern is contained in the description (highest priority first). */
export function matchRule<R extends Rule>(rules: R[], description: string, type: 'expense' | 'income'): R | null {
	const text = normalizeText(description);
	if (!text) return null;
	const candidates = rules
		.filter((r) => r.isActive && (r.type === 'any' || r.type === type))
		.sort((a, b) => b.priority - a.priority || a.id - b.id);
	return candidates.find((r) => {
		const pattern = normalizeText(r.pattern);
		return pattern !== '' && text.includes(pattern);
	}) || null;
}
