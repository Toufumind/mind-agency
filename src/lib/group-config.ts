/**
 * Group Configuration — owner, admins, permissions.
 *
 * Groups/<name>/config.json stores:
 *   { owner: string, admins: string[], createdAt: number }
 *
 * Anyone can send messages. Admin actions (kick, set_admin, edit workflow,
 * delete group) require owner or admin role.
 */

import fs from 'fs';
import path from 'path';
import { GROUPS_DIR } from './data-dir';

export interface GroupAnnouncement {
  title: string;
  content: string;
  pinnedAt: number;
  pinnedBy: string;
}

export type MemberRole = 'owner' | 'admin' | 'member';

export interface GroupConfig {
  owner: string;
  admins: string[];
  createdAt: number;
  name?: string;
  description?: string;
  announcement?: GroupAnnouncement;
  memberRoles?: Record<string, MemberRole>;
}

export function getMemberRole(config: GroupConfig, agent: string): MemberRole {
  const name = agent.toLowerCase();
  if (config.owner.toLowerCase() === name) return 'owner';
  if (config.admins.some(a => a.toLowerCase() === name)) return 'admin';
  if (config.memberRoles?.[agent]) return config.memberRoles[agent];
  return 'member';
}

export function setMemberRole(group: string, agent: string, role: MemberRole): boolean {
  const config = loadGroupConfig(group);
  if (!config) return false;
  if (!config.memberRoles) config.memberRoles = {};
  config.memberRoles[agent] = role;
  // Sync with admins list for backward compat
  if (role === 'admin' && !config.admins.some(a => a.toLowerCase() === agent.toLowerCase())) {
    config.admins.push(agent);
  }
  if (role !== 'admin') {
    config.admins = config.admins.filter(a => a.toLowerCase() !== agent.toLowerCase());
  }
  saveGroupConfig(group, config);
  return true;
}

// ── Group config cache ──────────────────────────────────
const groupConfigCache = new Map<string, { data: GroupConfig | null; ts: number }>();
const GROUP_CONFIG_TTL = 60_000; // 1 min

export function loadGroupConfig(group: string): GroupConfig | null {
  const cached = groupConfigCache.get(group);
  const now = Date.now();
  if (cached && (now - cached.ts) < GROUP_CONFIG_TTL) return cached.data;

  const fp = configFile(group);
  let data: GroupConfig | null = null;
  try {
    if (fs.existsSync(fp)) data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch {}

  groupConfigCache.set(group, { data, ts: now });
  return data;
}

export function saveGroupConfig(group: string, config: GroupConfig): void {
  const fp = configFile(group);
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(config, null, 2), 'utf-8');
  // Invalidate cache after write
  groupConfigCache.delete(group);
}

/** Invalidate group config cache */
export function invalidateGroupConfigCache(group?: string): void {
  if (group) groupConfigCache.delete(group);
  else groupConfigCache.clear();
}

export function ensureGroupConfig(group: string, owner: string): GroupConfig {
  const existing = loadGroupConfig(group);
  if (existing) return existing;
  const config: GroupConfig = { owner, admins: [], createdAt: Date.now() };
  saveGroupConfig(group, config);
  return config;
}

/** Check if agent is owner or admin of the group */
export function isGroupAdmin(group: string, agent: string): boolean {
  const config = loadGroupConfig(group);
  if (!config) return false;
  const name = agent.toLowerCase();
  if (config.owner.toLowerCase() === name) return true;
  return config.admins.some(a => a.toLowerCase() === name);
}

export function isGroupOwner(group: string, agent: string): boolean {
  const config = loadGroupConfig(group);
  if (!config) return false;
  return config.owner.toLowerCase() === agent.toLowerCase();
}

/** Add a member to the group (create Agents/<name>/email/) */
export function addMember(group: string, agentName: string): boolean {
  const gDir = path.join(GROUPS_DIR, group);
  if (!fs.existsSync(gDir)) return false;
  const agDir = path.join(gDir, 'Agents', agentName);
  if (fs.existsSync(agDir)) return false; // already a member
  fs.mkdirSync(path.join(agDir, 'email'), { recursive: true });
  return true;
}

/** Kick a member from the group */
export function kickMember(group: string, agentName: string): boolean {
  const gDir = path.join(GROUPS_DIR, group);
  const agDir = path.join(gDir, 'Agents', agentName);
  if (!fs.existsSync(agDir)) return false;
  fs.rmSync(agDir, { recursive: true, force: true });
  return true;
}

/** Get group display info (name, description, announcement) */
export function getGroupInfo(group: string): { name?: string; description?: string; announcement?: GroupAnnouncement; owner: string; admins: string[] } | null {
  const config = loadGroupConfig(group);
  if (!config) return null;
  return { name: config.name, description: config.description, announcement: config.announcement, owner: config.owner, admins: config.admins };
}

/** Set group name and description (admin only) */
export function setGroupInfo(group: string, info: { name?: string; description?: string }): boolean {
  const config = loadGroupConfig(group);
  if (!config) return false;
  if (info.name !== undefined) config.name = info.name;
  if (info.description !== undefined) config.description = info.description;
  saveGroupConfig(group, config);
  return true;
}

/** Publish or update group announcement (admin only) */
export function setGroupAnnouncement(group: string, title: string, content: string, pinnedBy: string): boolean {
  const config = loadGroupConfig(group);
  if (!config) return false;
  config.announcement = { title, content, pinnedAt: Date.now(), pinnedBy };
  saveGroupConfig(group, config);
  return true;
}

/** Remove group announcement */
export function removeGroupAnnouncement(group: string): boolean {
  const config = loadGroupConfig(group);
  if (!config) return false;
  delete config.announcement;
  saveGroupConfig(group, config);
  return true;
}

function configFile(group: string): string {
  return path.join(GROUPS_DIR, group, 'config.json');
}
