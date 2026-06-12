/**
 * crypto.ts — Encryption utilities for sensitive data
 *
 * Uses AES-256-GCM for encryption with machine-specific key derivation.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { MIND_DIR } from './data-dir';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 64;

const KEY_FILE = path.join(MIND_DIR, '.encryption-key');

/**
 * Get or create encryption key
 * Key is derived from machine-specific data + stored salt
 */
function getEncryptionKey(): Buffer {
  // Check if key file exists
  if (fs.existsSync(KEY_FILE)) {
    try {
      const keyData = fs.readFileSync(KEY_FILE, 'utf-8');
      return Buffer.from(keyData, 'hex');
    } catch (err) {
      console.warn(`[crypto] Failed to read key file:`, err);
    }
  }

  // Generate new key from machine-specific data
  const machineId = getMachineId();
  const salt = crypto.randomBytes(SALT_LENGTH);

  // Derive key using PBKDF2
  const key = crypto.pbkdf2Sync(machineId, salt, 100000, KEY_LENGTH, 'sha512');

  // Save key and salt
  const keyHex = key.toString('hex');
  const saltHex = salt.toString('hex');
  fs.writeFileSync(KEY_FILE, `${keyHex}:${saltHex}`, { mode: 0o600 });

  return key;
}

/**
 * Get machine-specific identifier
 */
function getMachineId(): string {
  const parts: string[] = [];

  // hostname
  parts.push(require('os').hostname());

  // username
  parts.push(require('os').userInfo().username);

  // platform
  parts.push(process.platform);

  // arch
  parts.push(process.arch);

  // Combine and hash
  return crypto.createHash('sha256').update(parts.join('-')).digest('hex');
}

/**
 * Encrypt a string
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const tag = cipher.getAuthTag();

  // Format: iv:tag:encrypted
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a string
 */
export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();

  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Check if a string is encrypted
 */
export function isEncrypted(data: string): boolean {
  // Encrypted data has format: hex:hex:hex
  if (!data || typeof data !== 'string') return false;

  const parts = data.split(':');
  if (parts.length !== 3) return false;

  // Check if all parts are valid hex and reasonable length
  return parts.every(part => /^[0-9a-f]+$/i.test(part) && part.length > 0);
}

/**
 * Encrypt API key if not already encrypted
 */
export function encryptApiKey(apiKey: string): string {
  if (!apiKey) return apiKey;
  if (isEncrypted(apiKey)) return apiKey;
  return encrypt(apiKey);
}

/**
 * Decrypt API key if encrypted
 */
export function decryptApiKey(apiKey: string): string {
  if (!apiKey) return apiKey;
  if (!isEncrypted(apiKey)) return apiKey;
  return decrypt(apiKey);
}

/**
 * Hash a value (one-way, for comparison)
 */
export function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Generate a secure random token
 */
export function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}
