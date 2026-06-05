import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/** GET /api/system/export — download a full JSON backup of all Mind Agency data */
export async function GET() {
  const dataDir = process.env.MIND_DATA_DIR || process.cwd();

  try {
    const manifest: Record<string, any> = { exportedAt: new Date().toISOString(), agents: {}, groups: {} };

    // Agents
    const agentsDir = path.join(dataDir, 'Agents');
    if (fs.existsSync(agentsDir)) {
      for (const a of fs.readdirSync(agentsDir, { withFileTypes: true })) {
        if (!a.isDirectory() || a.name.startsWith('.')) continue;
        const ad = path.join(agentsDir, a.name);
        manifest.agents[a.name] = {};
        const cfg = path.join(ad, 'config.json');
        if (fs.existsSync(cfg)) manifest.agents[a.name].config = JSON.parse(fs.readFileSync(cfg, 'utf-8'));

        const emDir = path.join(ad, 'email');
        if (fs.existsSync(emDir)) {
          manifest.agents[a.name].emails = fs.readdirSync(emDir).filter(f => f.endsWith('.md')).map(f => {
            const raw = fs.readFileSync(path.join(emDir, f), 'utf-8');
            const m = raw.match(/^---\nfrom:\s*(.+?)\nto:\s*(.+?)\nsubject:\s*(.+?)\ndate:\s*(.+?)\n---\n([\s\S]*)/);
            return m ? { from: m[1].trim(), to: m[2].trim(), subject: m[3].trim(), date: m[4].trim(), body: m[5].trim(), file: f } : null;
          }).filter(Boolean);
        }
      }
    }

    // Groups
    const groupsDir = path.join(dataDir, 'Groups');
    if (fs.existsSync(groupsDir)) {
      for (const g of fs.readdirSync(groupsDir, { withFileTypes: true })) {
        if (!g.isDirectory() || g.name.startsWith('.')) continue;
        manifest.groups[g.name] = {};
        const gd = path.join(groupsDir, g.name);
        const gCfg = path.join(gd, 'config.json');
        if (fs.existsSync(gCfg)) manifest.groups[g.name].config = JSON.parse(fs.readFileSync(gCfg, 'utf-8'));
        const agDir = path.join(gd, 'Agents');
        if (fs.existsSync(agDir)) manifest.groups[g.name].members = fs.readdirSync(agDir).filter(f => fs.statSync(path.join(agDir, f)).isDirectory());
        const wf = path.join(gd, 'workflow.yaml');
        if (fs.existsSync(wf)) manifest.groups[g.name].workflow = fs.readFileSync(wf, 'utf-8');
        const chatDir = path.join(gd, 'chat');
        if (fs.existsSync(chatDir)) {
          manifest.groups[g.name].messages = fs.readdirSync(chatDir).filter(f => f.endsWith('.md')).map(f => {
            const raw = fs.readFileSync(path.join(chatDir, f), 'utf-8');
            const m = raw.match(/^---\nfrom:\s*(.+?)\ndate:\s*(.+?)\n---\n\n([\s\S]*)/);
            return m ? { from: m[1].trim(), date: m[2].trim(), body: m[3].trim() } : null;
          }).filter(Boolean);
        }
      }
    }

    // Token usage
    const tokenFile = path.join(dataDir, '.audit', 'tokens.jsonl');
    if (fs.existsSync(tokenFile)) {
      manifest.tokens = fs.readFileSync(tokenFile, 'utf-8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    }

    const json = JSON.stringify(manifest, null, 2);
    return new NextResponse(json, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="mind-agency-backup-${new Date().toISOString().split('T')[0]}.json"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
