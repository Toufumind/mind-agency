/**
 * Crypto Tests
 */

import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, isEncrypted, encryptApiKey, decryptApiKey, hash, generateToken } from '../src/lib/crypto';

describe('Crypto', () => {
  it('should encrypt and decrypt string', () => {
    const original = 'my-secret-api-key';
    const encrypted = encrypt(original);

    expect(encrypted).not.toBe(original);
    expect(isEncrypted(encrypted)).toBe(true);

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it('should detect encrypted strings', () => {
    // Valid encrypted format: hex:hex:hex
    const encrypted = encrypt('test');
    expect(isEncrypted(encrypted)).toBe(true);
    expect(isEncrypted('not-encrypted')).toBe(false);
    expect(isEncrypted('abc:def')).toBe(false); // only 2 parts
  });

  it('should encrypt and decrypt API key', () => {
    const apiKey = 'sk-1234567890abcdef';
    const encrypted = encryptApiKey(apiKey);

    expect(encrypted).not.toBe(apiKey);
    expect(isEncrypted(encrypted)).toBe(true);

    const decrypted = decryptApiKey(encrypted);
    expect(decrypted).toBe(apiKey);
  });

  it('should handle already encrypted API key', () => {
    const apiKey = 'sk-1234567890abcdef';
    const encrypted1 = encryptApiKey(apiKey);
    const encrypted2 = encryptApiKey(encrypted1);

    // Should not double-encrypt
    expect(encrypted2).toBe(encrypted1);
  });

  it('should hash string consistently', () => {
    const value = 'test-value';
    const hash1 = hash(value);
    const hash2 = hash(value);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  it('should generate random token', () => {
    const token1 = generateToken();
    const token2 = generateToken();

    expect(token1).not.toBe(token2);
    expect(token1).toHaveLength(64); // 32 bytes = 64 hex chars
  });

  it('should generate token with custom length', () => {
    const token = generateToken(16);
    expect(token).toHaveLength(32); // 16 bytes = 32 hex chars
  });

  it('should throw on invalid ciphertext', () => {
    expect(() => decrypt('invalid')).toThrow();
    expect(() => decrypt('abc:def:ghi')).toThrow(); // invalid hex
  });
});
