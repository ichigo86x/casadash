import { afterEach, describe, expect, it } from 'vitest';
import { isRequestAllowed } from '../src/lib/server/csrf';
import { sniffReceiptType } from '../src/lib/server/receipts';

const h = (o: Record<string, string>) => new Headers(o);

describe('CSRF check', () => {
	afterEach(() => delete process.env.TRUSTED_ORIGINS);

	it('lets safe methods through', () => {
		expect(isRequestAllowed('GET', h({ 'sec-fetch-site': 'cross-site' }), 'a:8099')).toBe(true);
	});
	it('trusts the browser verdict', () => {
		expect(isRequestAllowed('POST', h({ 'sec-fetch-site': 'same-origin' }), 'a:8099')).toBe(true);
		expect(isRequestAllowed('POST', h({ 'sec-fetch-site': 'none' }), 'a:8099')).toBe(true);
		expect(isRequestAllowed('POST', h({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }), 'a:8099')).toBe(false);
	});
	it('refuses another port on the same host (same-site)', () => {
		expect(isRequestAllowed('POST', h({ 'sec-fetch-site': 'same-site', origin: 'http://nas:9000', host: 'nas:8099' }), 'nas:8099')).toBe(false);
	});
	it('falls back to comparing Origin and Host', () => {
		expect(isRequestAllowed('POST', h({ origin: 'http://nas:8099', host: 'nas:8099' }), 'nas:8099')).toBe(true);
		expect(isRequestAllowed('POST', h({ origin: 'http://nas:9000', host: 'nas:8099' }), 'nas:8099')).toBe(false);
		expect(isRequestAllowed('POST', h({ origin: 'null', host: 'nas:8099' }), 'nas:8099')).toBe(false);
		expect(isRequestAllowed('POST', h({ host: 'nas:8099' }), 'nas:8099')).toBe(true); // not a browser form
	});
	it('honours TRUSTED_ORIGINS and X-Forwarded-Host', () => {
		process.env.TRUSTED_ORIGINS = 'https://casa.example.com';
		expect(isRequestAllowed('POST', h({ 'sec-fetch-site': 'cross-site', origin: 'https://casa.example.com' }), 'x')).toBe(true);
		expect(isRequestAllowed('POST', h({ origin: 'https://casa.lan', 'x-forwarded-host': 'casa.lan' }), 'internal:8099')).toBe(true);
	});
});

describe('receipt sniffing', () => {
	const pad = (b: number[]) => Buffer.concat([Buffer.from(b), Buffer.alloc(16)]);
	it('recognises real formats by content', () => {
		expect(sniffReceiptType(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
		expect(sniffReceiptType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
		expect(sniffReceiptType(Buffer.from('%PDF-1.7\n%xxxxxxxx'))).toBe('pdf');
		expect(sniffReceiptType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
	});
	it('refuses anything else, whatever its name', () => {
		expect(sniffReceiptType(Buffer.from('<svg onload=alert(1)></svg>'))).toBeNull();
		expect(sniffReceiptType(Buffer.from('<?php echo 1; ?> padding padding'))).toBeNull();
	});
});
