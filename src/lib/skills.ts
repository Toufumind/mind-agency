/**
 * Skills System — Package manager for AI skills from GitHub repos.
 *
 * Inspired by CC Switch:
 * - Install from GitHub repos
 * - SHA-256 hash for update detection
 * - Backup before uninstall
 * - Symlink or copy to agent directories
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { MIND_DIR, AGENTS_DIR } from './data-dir';
import { randomUUID } from 'crypto';

// ── Types ────────────────────────────────────────────────

export interface Skill {
  id: string;
  name: string;
  description: string;
  repo: string;           // "owner/repo"
  repoPath?: string;      // subdirectory in repo
  installedAt: number;
  version: string;        // SHA-256 hash of content
  status: 'installed' | 'update_available';
  prompt?: string;        // cached prompt.md content
}

export interface SkillSearchResult {
  name: string;
  repo: string;
  description: string;
  stars: number;
  path: string;
}

// ── Storage ──────────────────────────────────────────────

const SKILLS_FILE = path.join(MIND_DIR, 'skills.json');
const SKILLS_DIR = path.join(MIND_DIR, 'skills');
const BACKUPS_DIR = path.join(MIND_DIR, 'skill-backups');
const MAX_BACKUPS = 20;

function ensureDirs(): void {
  for (const dir of [MIND_DIR, SKILLS_DIR, BACKUPS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function loadSkills(): Skill[] {
  ensureDirs();
  try {
    if (fs.existsSync(SKILLS_FILE)) {
      return JSON.parse(fs.readFileSync(SKILLS_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

function saveSkills(skills: Skill[]): void {
  ensureDirs();
  fs.writeFileSync(SKILLS_FILE, JSON.stringify(skills, null, 2), 'utf-8');
}

// ── GitHub API ───────────────────────────────────────────

async function githubGet(url: string): Promise<any> {
  const headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json' };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers['Authorization'] = `token ${token}`;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return res.json();
}

async function githubGetContent(repo: string, path: string): Promise<string> {
  const url = `https://api.github.com/repos/${repo}/contents/${path}`;
  const data = await githubGet(url);
  if (data.encoding === 'base64') {
    return Buffer.from(data.content, 'base64').toString('utf-8');
  }
  // If content is a URL, fetch it
  if (data.download_url) {
    const res = await fetch(data.download_url, { signal: AbortSignal.timeout(10000) });
    return res.text();
  }
  throw new Error('Unexpected content format');
}

async function githubGetTree(repo: string, path?: string): Promise<any[]> {
  const url = `https://api.github.com/repos/${repo}/contents/${path || ''}`;
  const data = await githubGet(url);
  return Array.isArray(data) ? data : [];
}

// ── Search ───────────────────────────────────────────────

export async function searchSkills(query: string): Promise<SkillSearchResult[]> {
  try {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}+skill+claude&sort=stars&per_page=10`;
    const data = await githubGet(url);
    return (data.items || []).map((r: any) => ({
      name: r.name,
      repo: r.full_name,
      description: r.description || '',
      stars: r.stargazers_count,
      path: '',
    }));
  } catch {
    return [];
  }
}

// ── Install ──────────────────────────────────────────────

async function downloadRepo(repo: string, repoPath?: string): Promise<{ files: Map<string, string>; version: string }> {
  const files = new Map<string, string>();

  async function downloadDir(dirPath: string) {
    const items = await githubGetTree(repo, dirPath);
    for (const item of items) {
      if (item.type === 'file') {
        const content = await githubGetContent(repo, item.path);
        files.set(item.path, content);
      } else if (item.type === 'dir') {
        await downloadDir(item.path);
      }
    }
  }

  await downloadDir(repoPath || '');

  // Compute SHA-256 hash of all content
  const hash = crypto.createHash('sha256');
  for (const [path, content] of [...files.entries()].sort()) {
    hash.update(path);
    hash.update(content);
  }
  const version = hash.digest('hex').slice(0, 16);

  return { files, version };
}

export async function installSkill(repo: string, repoPath?: string): Promise<Skill> {
  ensureDirs();

  // Check if already installed
  const existing = loadSkills().find(s => s.repo === repo && s.repoPath === (repoPath || ''));
  if (existing) throw new Error(`Skill from ${repo} already installed`);

  // Download from GitHub
  const { files, version } = await downloadRepo(repo, repoPath);

  // Extract skill name from repo or path
  const skillName = repoPath?.split('/').pop() || repo.split('/').pop() || 'unknown';

  // Write files to skills directory
  const skillDir = path.join(SKILLS_DIR, skillName);
  if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true });
  fs.mkdirSync(skillDir, { recursive: true });

  for (const [filePath, content] of files) {
    // Strip repoPath prefix if present
    const relativePath = repoPath ? filePath.replace(repoPath + '/', '') : filePath;
    const fullPath = path.join(skillDir, relativePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }

  // Read prompt.md if exists
  const promptPath = path.join(skillDir, 'prompt.md');
  const prompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf-8') : undefined;

  // Read description from README.md
  const readmePath = path.join(skillDir, 'README.md');
  const description = fs.existsSync(readmePath)
    ? fs.readFileSync(readmePath, 'utf-8').slice(0, 200).replace(/^#.*\n/, '').trim()
    : '';

  // Create skill record
  const skill: Skill = {
    id: randomUUID().slice(0, 8),
    name: skillName,
    description,
    repo,
    repoPath,
    installedAt: Date.now(),
    version,
    status: 'installed',
    prompt,
  };

  const skills = loadSkills();
  skills.push(skill);
  saveSkills(skills);

  // Distribute to agent directories
  distributeToAgents(skillName);

  return skill;
}

// ── Uninstall ────────────────────────────────────────────

export function uninstallSkill(id: string): boolean {
  const skills = loadSkills();
  const idx = skills.findIndex(s => s.id === id);
  if (idx === -1) return false;

  const skill = skills[idx];
  const skillDir = path.join(SKILLS_DIR, skill.name);

  // Backup before removal
  if (fs.existsSync(skillDir)) {
    const backupDir = path.join(BACKUPS_DIR, `${skill.name}_${Date.now()}`);
    fs.cpSync(skillDir, backupDir);

    // Cleanup old backups (keep MAX_BACKUPS)
    const backups = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.startsWith(skill.name + '_'))
      .sort();
    while (backups.length > MAX_BACKUPS) {
      fs.rmSync(path.join(BACKUPS_DIR, backups.shift()!), { recursive: true });
    }
  }

  // Remove from skills directory
  if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true });

  // Remove from agent directories
  removeFromAgents(skill.name);

  // Remove from skills list
  skills.splice(idx, 1);
  saveSkills(skills);

  // Rebuild embedding index
  buildSkillIndex();

  return true;
}

// ── Update check ─────────────────────────────────────────

export async function checkSkillUpdates(): Promise<string[]> {
  const skills = loadSkills();
  const updated: string[] = [];

  for (const skill of skills) {
    try {
      const { version } = await downloadRepo(skill.repo, skill.repoPath);
      if (version !== skill.version) {
        skill.status = 'update_available';
        updated.push(skill.id);
      } else {
        skill.status = 'installed';
      }
    } catch {}
  }

  saveSkills(skills);
  return updated;
}

export async function updateSkill(id: string): Promise<Skill | null> {
  const skills = loadSkills();
  const skill = skills.find(s => s.id === id);
  if (!skill) return null;

  // Uninstall old version (with backup)
  const skillDir = path.join(SKILLS_DIR, skill.name);
  if (fs.existsSync(skillDir)) {
    const backupDir = path.join(BACKUPS_DIR, `${skill.name}_${Date.now()}`);
    fs.cpSync(skillDir, backupDir);
  }
  if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true });

  // Reinstall
  const { files, version } = await downloadRepo(skill.repo, skill.repoPath);

  fs.mkdirSync(skillDir, { recursive: true });
  for (const [filePath, content] of files) {
    const relativePath = skill.repoPath ? filePath.replace(skill.repoPath + '/', '') : filePath;
    const fullPath = path.join(skillDir, relativePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }

  // Update record
  skill.version = version;
  skill.status = 'installed';
  skill.installedAt = Date.now();

  const promptPath = path.join(skillDir, 'prompt.md');
  skill.prompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf-8') : undefined;

  saveSkills(skills);
  distributeToAgents(skill.name);

  // Rebuild embedding index
  buildSkillIndex();

  return skill;
}

// ── Distribution to agent directories ────────────────────

function distributeToAgents(skillName: string): void {
  const srcDir = path.join(SKILLS_DIR, skillName);
  if (!fs.existsSync(srcDir)) return;

  // Distribute to each agent's skills directory
  if (!fs.existsSync(AGENTS_DIR)) return;
  const agents = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name);

  for (const agent of agents) {
    const destDir = path.join(AGENTS_DIR, agent, 'skills', skillName);
    const destParent = path.dirname(destDir);
    if (!fs.existsSync(destParent)) fs.mkdirSync(destParent, { recursive: true });
    if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true });
    fs.cpSync(srcDir, destDir);
  }
}

function removeFromAgents(skillName: string): void {
  if (!fs.existsSync(AGENTS_DIR)) return;
  const agents = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name);

  for (const agent of agents) {
    const skillDir = path.join(AGENTS_DIR, agent, 'skills', skillName);
    if (fs.existsSync(skillDir)) fs.rmSync(skillDir, { recursive: true });
  }
}

// ── Skill RAG — Embedding-based retrieval ────────────────

import { embed, cosineSimilarity } from './embedding';

interface SkillEntry {
  skillId: string;
  skillName: string;
  content: string;
  embedding: number[];
}

// In-memory index (rebuilt on startup)
let skillIndex: SkillEntry[] = [];

/**
 * Build embedding index for all installed skills.
 * Each skill = one entry (entire prompt.md).
 */
export function buildSkillIndex(): void {
  skillIndex = [];
  const skills = loadSkills();

  for (const skill of skills) {
    const skillDir = path.join(SKILLS_DIR, skill.name);
    if (!fs.existsSync(skillDir)) continue;

    const promptPath = path.join(skillDir, 'prompt.md');
    if (fs.existsSync(promptPath)) {
      try {
        const content = fs.readFileSync(promptPath, 'utf-8').trim();
        if (content) {
          skillIndex.push({
            skillId: skill.id,
            skillName: skill.name,
            content,
            embedding: embed(content),
          });
        }
      } catch {}
    }
  }

  console.log(`[skills] Indexed ${skillIndex.length} skills`);
}

/**
 * Search relevant skills for a given task.
 * Returns top-K most relevant skills.
 */
export function searchRelevantSkills(task: string, topK = 3): SkillEntry[] {
  if (skillIndex.length === 0) buildSkillIndex();
  if (skillIndex.length === 0) return [];

  const taskEmbedding = embed(task);

  return skillIndex
    .map(s => ({ ...s, score: cosineSimilarity(taskEmbedding, s.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter(s => s.score > 0.1);
}

// ── Load skills context (RAG version) ────────────────────

/**
 * Load skills context using RAG — only injects relevant skills.
 * Falls back to full injection if no task context available.
 */
export function loadSkillsContext(agentName: string, taskContext?: string): string {
  const agentDir = path.join(AGENTS_DIR, agentName, 'skills');
  if (!fs.existsSync(agentDir)) return '';

  const installedSkills = fs.readdirSync(agentDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  if (installedSkills.length === 0) return '';

  // No task context → inject all (fallback)
  if (!taskContext) {
    const parts: string[] = [];
    for (const skillName of installedSkills) {
      const promptPath = path.join(agentDir, skillName, 'prompt.md');
      if (fs.existsSync(promptPath)) {
        try {
          const content = fs.readFileSync(promptPath, 'utf-8').trim();
          if (content) parts.push(`### Skill: ${skillName}\n${content}`);
        } catch {}
      }
    }
    return parts.length > 0 ? '\n\n[启用的 Skills]\n' + parts.join('\n\n') : '';
  }

  // RAG: search relevant skills
  const relevant = searchRelevantSkills(taskContext, 3);
  const agentRelevant = relevant.filter(r => installedSkills.includes(r.skillName));

  if (agentRelevant.length === 0) return '';

  const parts = agentRelevant.map(s => `[Skill: ${s.skillName}]\n${s.content}`);
  return '\n\n[相关 Skills]\n' + parts.join('\n\n');
}

// ── List ─────────────────────────────────────────────────

export function getInstalledSkills(): Skill[] {
  return loadSkills();
}

export function getSkill(id: string): Skill | undefined {
  return loadSkills().find(s => s.id === id);
}
