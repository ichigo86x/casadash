import { describe, expect, it } from 'vitest';
import { isValidDate, parseAmount, parseTags, validateTransaction } from '../src/lib/validate';
import { passwordProblem } from '../src/lib/passwordPolicy';

const form = (o: Record<string, string>) => ({ get: (k: string) => (k in o ? o[k] : null) });
const cats = [
	{ name: 'Cibo', type: 'expense' },
	{ name: 'Altro', type: 'expense' },
	{ name: 'Stipendio', type: 'income' }
];
const base = { type: 'expense', description: 'Spesa', amount: '12,50', date: '2026-03-04', category: 'Cibo', payment_method: 'bancomat', tags: '[]' };

describe('parseAmount', () => {
	it('accepts dot and comma decimals and rounds to cents', () => {
		expect(parseAmount('12,5')).toBe(12.5);
		expect(parseAmount('0.1')).toBe(0.1);
		expect(parseAmount(1.005 + 0.0000001)).toBe(1.01);
	});
	it('rejects zero, negatives, NaN, Infinity and absurd values', () => {
		for (const bad of ['0', '-3', 'abc', 'Infinity', '1e12', '', '0.001']) expect(parseAmount(bad)).toBeNull();
	});
});

describe('isValidDate', () => {
	it('checks the real calendar', () => {
		expect(isValidDate('2024-02-29')).toBe(true);
		expect(isValidDate('2025-02-29')).toBe(false);
		expect(isValidDate('2025-13-01')).toBe(false);
		expect(isValidDate('25-01-01')).toBe(false);
		expect(isValidDate('<script>')).toBe(false);
	});
});

describe('parseTags', () => {
	it('trims, de-duplicates and caps', () => {
		expect(parseTags('[" BNL ","bnl","Casa"]')).toEqual(['BNL', 'Casa']);
		expect(parseTags('not json')).toBeNull();
		expect(parseTags('{"a":1}')).toBeNull();
		expect(parseTags('[1,2]')).toBeNull();
		expect(parseTags(JSON.stringify(Array.from({ length: 31 }, (_, i) => 't' + i)))).toBeNull();
	});
});

describe('validateTransaction', () => {
	it('accepts a normal movement', () => {
		const r = validateTransaction(form(base), cats);
		expect('value' in r && r.value.amount).toBe(12.5);
	});
	it('falls back to Altro for unknown or wrong-type categories', () => {
		expect((validateTransaction(form({ ...base, category: 'Inventata' }), cats) as any).value.category).toBe('Altro');
		expect((validateTransaction(form({ ...base, category: 'Stipendio' }), cats) as any).value.category).toBe('Altro');
	});
	it('rejects a bad type, date or description', () => {
		expect('error' in validateTransaction(form({ ...base, type: 'transfer' }), cats)).toBe(true);
		expect('error' in validateTransaction(form({ ...base, date: '2026-02-31' }), cats)).toBe(true);
		expect('error' in validateTransaction(form({ ...base, description: 'x'.repeat(201) }), cats)).toBe(true);
		expect('error' in validateTransaction(form({ ...base, amount: 'Infinity' }), cats)).toBe(true);
	});
	it('converts a foreign amount with the rate (1 EUR = rate units)', () => {
		const r = validateTransaction(form({ ...base, amount: '', orig_currency: 'usd', orig_amount: '110', fx_rate: '1.10' }), cats) as any;
		expect(r.value.amount).toBe(100);
		expect(r.value.origCurrency).toBe('USD');
	});
	it('only credit cards can stay unsettled', () => {
		expect((validateTransaction(form({ ...base, payment_method: 'credit_card', settled: '0' }), cats) as any).value.settled).toBe(0);
		expect((validateTransaction(form({ ...base, settled: '0' }), cats) as any).value.settled).toBe(1);
	});
});

describe('passwordProblem', () => {
	it('enforces length, common passwords and username', () => {
		expect(passwordProblem('corta')).toBeTruthy();
		expect(passwordProblem('password123')).toBeTruthy();
		expect(passwordProblem('marco-è-il-migliore', 'marco')).toBeTruthy();
		expect(passwordProblem('aaaaaaaaaaaa')).toBeTruthy();
		expect(passwordProblem('cavallo-batteria-graffetta')).toBeNull();
	});
});
