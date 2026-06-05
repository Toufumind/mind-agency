/**
 * Agent Card — v0.4 (A2A-inspired)
 *
 * Agents publish capability metadata (like an API spec).
 * Other agents can discover and search by skill/capability.
 *
 * Storage: Agents/<name>/agent-card.json
 */

import fs from 'fs';
import path from 'path';
import { AGENTS_DIR } from './data-dir';

export interface AgentCard {
  name: string;
  capabilities: string[];
  roles: string[];
  status: 'online' | 'offline' | 'busy';
  maxConcurrentTasks: number;
  description?: string;
  lastSeen?: number;
}

const defaultCard: Omit<AgentCard, 'name'> = {
  capabilities: [],
  roles: [],
  status: 'offline',
  maxConcurrentTasks: 3,
};

/** Load an agent's card */
export function loadAgentCard(agentName: string): AgentCard | null {
  const cardPath = path.join(AGENTS_DIR, agentName, 'agent-card.json');
  try {
    if (!fs.existsSync(cardPath)) return null;
    return JSON.parse(fs.readFileSync(cardPath, 'utf-8'));
  } catch { return null; }
}

/** Save an agent's card */
export function saveAgentCard(agentName: string, card: Partial<AgentCard>): void {
  const agentDir = path.join(AGENTS_DIR, agentName);
  if (!fs.existsSync(agentDir)) return;
  const cardPath = path.join(agentDir, 'agent-card.json');
  const existing = loadAgentCard(agentName) || { ...defaultCard, name: agentName };
  const merged = { ...existing, ...card, name: agentName, lastSeen: Date.now() };
  fs.writeFileSync(cardPath, JSON.stringify(merged, null, 2), 'utf-8');
}

/** Auto-generate card from config.json */
export function autoGenerateCard(agentName: string): AgentCard {
  const configPath = path.join(AGENTS_DIR, agentName, 'config.json');
  let roles: string[] = [];
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      roles = config.roles || [];
    }
  } catch {}

  const card: AgentCard = {
    name: agentName,
    capabilities: roles.length > 0 ? [...roles] : ['general'],
    roles,
    status: 'offline',
    maxConcurrentTasks: 3,
    lastSeen: Date.now(),
  };
  saveAgentCard(agentName, card);
  return card;
}

/** Search agents by capability */
export function searchAgents(query: string): AgentCard[] {
  if (!fs.existsSync(AGENTS_DIR)) return [];
  const agents = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'));
  const q = query.toLowerCase();
  const results: AgentCard[] = [];
  for (const a of agents) {
    let card = loadAgentCard(a.name);
    if (!card) card = autoGenerateCard(a.name);
    // Match against capabilities, roles, name
    if (card.name.toLowerCase().includes(q) ||
        card.capabilities.some(c => c.toLowerCase().includes(q)) ||
        card.roles.some(r => r.toLowerCase().includes(q))) {
      results.push(card);
    }
  }
  return results;
}

/** List all agents with their cards */
export function listAgentCards(): AgentCard[] {
  if (!fs.existsSync(AGENTS_DIR)) return [];
  const agents = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'));
  return agents.map(a => {
    let card = loadAgentCard(a.name);
    if (!card) card = autoGenerateCard(a.name);
    return card;
  });
}
