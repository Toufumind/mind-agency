/**
 * Skills Tests
 */

import { describe, it, expect, vi } from 'vitest';
import path from 'path';

vi.mock('../src/lib/data-dir', () => ({
  MIND_DIR: path.join(__dirname, '.test-data', '.mind'),
  AGENTS_DIR: path.join(__dirname, '.test-data', 'Agents'),
  default: path.join(__dirname, '.test-data'),
}));

import {
  getInstalledSkills,
  isSkillEnabled,
  enableSkill,
  disableSkill,
  getEnabledSkills,
} from '../src/lib/skills';

describe('Skills', () => {
  it('should get installed skills', () => {
    const skills = getInstalledSkills();
    expect(Array.isArray(skills)).toBe(true);
  });

  it('should check if skill is enabled', () => {
    const enabled = isSkillEnabled('test-agent', 'test-skill');
    expect(typeof enabled).toBe('boolean');
  });

  it('should get enabled skills', () => {
    const skills = getEnabledSkills('test-agent');
    expect(Array.isArray(skills)).toBe(true);
  });
});
