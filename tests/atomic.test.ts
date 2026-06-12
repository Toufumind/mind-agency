/**
 * Atomic Tests
 */

import { describe, it, expect } from 'vitest';
import { atomicWrite } from '../src/lib/atomic';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Atomic', () => {
  it('should write file atomically', () => {
    const tmpDir = os.tmpdir();
    const testFile = path.join(tmpDir, `test-atomic-${Date.now()}.txt`);

    try {
      atomicWrite(testFile, 'test content');
      expect(fs.existsSync(testFile)).toBe(true);
      expect(fs.readFileSync(testFile, 'utf-8')).toBe('test content');
    } finally {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    }
  });

  it('should overwrite existing file', () => {
    const tmpDir = os.tmpdir();
    const testFile = path.join(tmpDir, `test-atomic-overwrite-${Date.now()}.txt`);

    try {
      atomicWrite(testFile, 'original');
      atomicWrite(testFile, 'updated');
      expect(fs.readFileSync(testFile, 'utf-8')).toBe('updated');
    } finally {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    }
  });
});
