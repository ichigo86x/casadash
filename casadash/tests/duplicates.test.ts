import { describe, expect, it } from 'vitest';
import { findSimilar, references, worst, type Known } from '../src/lib/duplicates';

const k = (o: Partial<Known> & { id: number }): Known => ({ date: '2026-11-10', amount: 20, type: 'expense', description: 'x', ...o });
const c = (o: object = {}) => ({ date: '2026-11-10', amount: 20, type: 'expense', description: 'Altro', ...o });

describe('findSimilar', () => {
	it('flags the same bank id, or same day amount and description, as exact', () => {
		expect(findSimilar(c({ externalId: 'A1' }), [k({ id: 1, date: '2026-11-12', externalId: 'A1' })])[0].level).toBe('exact');
		expect(findSimilar(c({ description: 'ESSELUNGA 12345' }), [k({ id: 2, description: 'Esselunga' })])[0].level).toBe('exact');
	});
	it('ignores other amounts, other types and dates beyond three days', () => {
		expect(findSimilar(c(), [k({ id: 1, amount: 20.5 }), k({ id: 2, type: 'income' }), k({ id: 3, date: '2026-11-20' })])).toHaveLength(0);
	});
	it('matches a shared transaction reference even with other words and days apart', () => {
		const [m] = findSimilar(
			c({ date: '2026-11-12', description: 'PayPal 5AB12345CD6789012 Amazon' }),
			[k({ id: 1, description: 'PAYPAL EUROPE SARL 5AB12345CD6789012 1234', date: '2026-11-10' })]
		);
		expect(m.level).toBe('strong');
		expect(m.reason).toContain('5AB12345CD6789012');
	});
	it('matches the same merchant a day apart', () => {
		const [m] = findSimilar(c({ date: '2026-11-11', description: 'Pagamento Zalando' }), [k({ id: 1, description: 'ZALANDO SE BERLIN' })]);
		expect(m.level).toBe('strong');
	});
	it('same day and amount without anything else in common is only probable', () => {
		const [m] = findSimilar(c({ description: 'Bonifico Mario' }), [k({ id: 1, description: 'Farmacia Rossi' })]);
		expect(m.level).toBe('probable');
	});
	it('a few days apart needs another source (a PayPal payment and its bank charge)', () => {
		const paypal = c({ date: '2026-11-12', description: 'Libreria', tags: ['PayPal'], paymentMethod: 'bancomat' });
		expect(findSimilar(paypal, [k({ id: 1, description: 'PAYPAL *LIBRERIA', date: '2026-11-10', tags: ['BancoPosta'], paymentMethod: 'bancomat' })])[0].level).toBe('strong');
		// same account, different days, no common word: two separate purchases
		expect(findSimilar(paypal, [k({ id: 2, description: 'Caffe', date: '2026-11-10', tags: ['PayPal'], paymentMethod: 'bancomat' })])).toHaveLength(0);
		// different account and different days: worth asking
		expect(findSimilar(paypal, [k({ id: 3, description: 'Caffe', date: '2026-11-10', tags: ['BancoPosta'], paymentMethod: 'bancomat' })])[0].level).toBe('probable');
	});
	it('puts the most certain match first', () => {
		const out = findSimilar(c({ description: 'Zalando' }), [k({ id: 1, description: 'Farmacia' }), k({ id: 2, description: 'Zalando' })]);
		expect(out.map((m) => m.known.id)).toEqual([2, 1]);
		expect(worst(out)).toBe('exact');
		expect(worst([])).toBeNull();
	});
});

describe('references', () => {
	it('keeps codes with digits and drops plain words and short numbers', () => {
		expect(references('Pagamento 5AB12345CD6789012 Amazon 20/11 12345')).toEqual(['5AB12345CD6789012']);
		expect(references('CRO 12345678901 ordine')).toEqual(['12345678901']);
		expect(references('PAGAMENTOONLINE')).toEqual([]);
	});
});
