import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt } from '../../src/crypto/secretBox.js';

function key(): Buffer {
	return randomBytes(32);
}

describe('secretBox', () => {
	it('round-trips a value', () => {
		const k = key();
		const plaintext = Buffer.from('a 32-byte connection secret-ish value', 'utf8');
		const encrypted = encrypt(plaintext, k);
		expect(decrypt(encrypted, k)).toEqual(plaintext);
	});

	it('produces a different encrypted value each time, from a fresh IV', () => {
		const k = key();
		const plaintext = Buffer.from('same plaintext', 'utf8');
		const first = encrypt(plaintext, k);
		const second = encrypt(plaintext, k);
		expect(first.equals(second)).toBe(false);
	});

	it('fails when a byte of the encrypted value is tampered with', () => {
		const k = key();
		const encrypted = encrypt(Buffer.from('secret value', 'utf8'), k);
		const tampered = Buffer.from(encrypted);
		tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;
		expect(() => decrypt(tampered, k)).toThrow();
	});

	it('fails when the IV itself is tampered with', () => {
		const k = key();
		const encrypted = encrypt(Buffer.from('secret value', 'utf8'), k);
		const tampered = Buffer.from(encrypted);
		tampered[0] = tampered[0]! ^ 0xff;
		expect(() => decrypt(tampered, k)).toThrow();
	});

	it('fails with the wrong key', () => {
		const encrypted = encrypt(Buffer.from('secret value', 'utf8'), key());
		expect(() => decrypt(encrypted, key())).toThrow();
	});

	it('round-trips a 32-byte binary secret, not just text', () => {
		const k = key();
		const plaintext = randomBytes(32);
		const encrypted = encrypt(plaintext, k);
		expect(decrypt(encrypted, k)).toEqual(plaintext);
	});
});
