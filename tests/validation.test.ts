/**
 * Validation Tests
 */

import { describe, it, expect } from 'vitest';
import {
  validateAgentName,
  validateGroupName,
  validateMessage,
  validateEmail,
  validateUrl,
  sanitizeDisplay,
  sanitizeFilename,
} from '../src/lib/validation';

describe('Validation', () => {
  describe('validateAgentName', () => {
    it('should accept valid agent names', () => {
      expect(validateAgentName('alice').valid).toBe(true);
      expect(validateAgentName('Bob-123').valid).toBe(true);
      expect(validateAgentName('my_agent').valid).toBe(true);
    });

    it('should reject empty names', () => {
      expect(validateAgentName('').valid).toBe(false);
    });

    it('should reject names with special characters', () => {
      expect(validateAgentName('alice@bob').valid).toBe(false);
      expect(validateAgentName('alice bob').valid).toBe(false);
      expect(validateAgentName('alice/bob').valid).toBe(false);
    });

    it('should reject names starting with . or -', () => {
      expect(validateAgentName('.hidden').valid).toBe(false);
      expect(validateAgentName('-name').valid).toBe(false);
    });

    it('should reject names over 50 characters', () => {
      const longName = 'a'.repeat(51);
      expect(validateAgentName(longName).valid).toBe(false);
    });
  });

  describe('validateGroupName', () => {
    it('should accept valid group names', () => {
      expect(validateGroupName('default').valid).toBe(true);
      expect(validateGroupName('my-group').valid).toBe(true);
    });

    it('should reject empty names', () => {
      expect(validateGroupName('').valid).toBe(false);
    });
  });

  describe('validateMessage', () => {
    it('should accept valid messages', () => {
      expect(validateMessage('Hello').valid).toBe(true);
      expect(validateMessage('A'.repeat(100000)).valid).toBe(true);
    });

    it('should reject empty messages', () => {
      expect(validateMessage('').valid).toBe(false);
    });

    it('should reject messages over 100,000 characters', () => {
      expect(validateMessage('A'.repeat(100001)).valid).toBe(false);
    });
  });

  describe('validateEmail', () => {
    it('should accept valid emails', () => {
      expect(validateEmail('user@example.com').valid).toBe(true);
      expect(validateEmail('test.name+tag@domain.co.uk').valid).toBe(true);
    });

    it('should reject invalid emails', () => {
      expect(validateEmail('').valid).toBe(false);
      expect(validateEmail('invalid').valid).toBe(false);
      expect(validateEmail('@domain.com').valid).toBe(false);
      expect(validateEmail('user@').valid).toBe(false);
    });
  });

  describe('validateUrl', () => {
    it('should accept valid URLs', () => {
      expect(validateUrl('https://example.com').valid).toBe(true);
      expect(validateUrl('http://localhost:3000').valid).toBe(true);
    });

    it('should accept empty URLs', () => {
      expect(validateUrl('').valid).toBe(true);
    });

    it('should reject invalid URLs', () => {
      expect(validateUrl('not-a-url').valid).toBe(false);
      expect(validateUrl('ftp://example.com').valid).toBe(false);
    });
  });

  describe('sanitizeDisplay', () => {
    it('should escape HTML entities', () => {
      expect(sanitizeDisplay('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
      );
    });

    it('should handle empty strings', () => {
      expect(sanitizeDisplay('')).toBe('');
      expect(sanitizeDisplay(null as any)).toBe('');
    });
  });

  describe('sanitizeFilename', () => {
    it('should sanitize special characters', () => {
      expect(sanitizeFilename('file name.txt')).toBe('file_name.txt');
      expect(sanitizeFilename('file:name?.txt')).toBe('file_name_.txt');
    });

    it('should handle empty filenames', () => {
      expect(sanitizeFilename('')).toBe('untitled');
    });

    it('should limit length', () => {
      const longName = 'a'.repeat(300) + '.txt';
      const result = sanitizeFilename(longName);
      expect(result.length).toBeLessThanOrEqual(255);
      expect(result).toMatch(/\.txt$/);
    });
  });
});
