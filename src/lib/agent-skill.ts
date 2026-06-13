/**
 * agent-skill.ts — Skill management for AgentProxy.
 */

import fs from 'fs';
import path from 'path';
import { AGENTS_DIR } from './data-dir';
import { AgentSkill } from './agent-types';

/**
 * Load skills installed for an agent.
 */
export async function loadAgentSkills(agentName: string): Promise<AgentSkill[]> {
  const skills: AgentSkill[] = [];
  try {
    const agentDir = path.join(AGENTS_DIR, agentName, 'skills');
    if (fs.existsSync(agentDir)) {
      const entries = fs.readdirSync(agentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const promptPath = path.join(agentDir, entry.name, 'prompt.md');
        let prompt: string | undefined;
        try {
          if (fs.existsSync(promptPath)) {
            prompt = fs.readFileSync(promptPath, 'utf-8').trim();
          }
        } catch (e) { console.error('[lib:agent-skill]', e); }
        skills.push({ name: entry.name, prompt });
      }
    }
  } catch (e) { console.error('[lib:agent-skill]', e); }
  return skills;
}

/**
 * Load skills context for injection into agent prompt.
 */
export async function loadAgentSkillsContext(agentName: string, context?: string): Promise<string> {
  const { loadSkillsContext } = await import('./skills');
  return loadSkillsContext(agentName, context);
}
