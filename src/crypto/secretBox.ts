import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Encrypts a value with AES-256-GCM: a random 12-byte IV, then the 16-byte auth tag, then the
 * ciphertext, concatenated in that order.
 */
export function encrypt(plaintext: Buffer, key: Buffer): Buffer {
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, tag, ciphertext]);
}

/**
 * Decrypts a value `encrypt` produced. Throws when the key is wrong or any byte was tampered with -
 * GCM's own tag check fails closed.
 */
export function decrypt(encrypted: Buffer, key: Buffer): Buffer {
	if (encrypted.length < IV_LENGTH + TAG_LENGTH) {
		throw new Error('encrypted value is too short to contain an IV and a tag');
	}
	const iv = encrypted.subarray(0, IV_LENGTH);
	const tag = encrypted.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
	const ciphertext = encrypted.subarray(IV_LENGTH + TAG_LENGTH);
	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
