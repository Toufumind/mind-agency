#!/usr/bin/env node
/**
 * Mind Agency — Windows Desktop GUI Build
 *
 * OUTPUT: dist-exe/Mind Agency-win32-x64/Mind Agency.exe
 * Double-click → native Windows window with full Mind Agency UI.
 * No browser needed. No Node.js needed.
 *
 * Usage: npm run build:exe
 */

import { existsSync, rmSync, mkdirSync, cpSync, writeFileSync, readFileSync, statSync, readdirSync, renameSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STAGING = path.join(ROOT, 'dist-electron-staging');
const STANDALONE = path.join(ROOT, '.next', 'standalone');
const OUT = path.join(ROOT, 'dist-exe');
const log = (s) => console.log(`  ${s}`);

console.log(`
╔══════════════════════════════════════════════╗
║   Mind Agency — Windows Desktop App Build    ║
║   Electron + Next.js → Native Window .exe    ║
╚══════════════════════════════════════════════╝`);

// ── 1. Next.js build ─────────────────────────────────────

console.log('\n[1/4] Next.js build');
if (!existsSync(path.join(STANDALONE, 'server.js'))) {
  log('Running `npm run build`...');
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
} else { log('✓ standalone exists'); }

// ── 2. Assemble app directory ────────────────────────────

console.log('\n[2/4] Assemble app');
if (existsSync(STAGING)) rmSync(STAGING, { recursive: true });
mkdirSync(STAGING, { recursive: true });

// Core: Next.js standalone
cpSync(STANDALONE, STAGING, { recursive: true });
log('✓ .next/standalone/');

// Node cpSync may copy standalone as subdirectory. Fix: move up.
const subDir = path.join(STAGING, 'standalone');
if (existsSync(subDir)) {
  // cpSync put standalone/ inside staging — move contents up
  const innerDir = path.join(subDir, '.next');
  if (existsSync(innerDir)) {
    if (existsSync(path.join(STAGING, '.next'))) rmSync(path.join(STAGING, '.next'), { recursive: true, force: true });
    renameSync(innerDir, path.join(STAGING, '.next'));
    const serverFile = path.join(subDir, 'server.js');
    if (existsSync(serverFile)) renameSync(serverFile, path.join(STAGING, 'server.js'));
    const pkgFile = path.join(subDir, 'package.json');
    if (existsSync(pkgFile)) renameSync(pkgFile, path.join(STAGING, 'package.json'));
    // Move node_modules
    const nmDir = path.join(subDir, 'node_modules');
    if (existsSync(nmDir)) {
      const destNm = path.join(STAGING, 'node_modules');
      if (!existsSync(destNm)) mkdirSync(destNm, { recursive: true });
      for (const nm of readdirSync(nmDir, { withFileTypes: true })) {
        const target = path.join(destNm, nm.name);
        if (!existsSync(target)) renameSync(path.join(nmDir, nm.name), target);
      }
    }
    rmSync(subDir, { recursive: true, force: true });
    log('  (moved standalone contents up)');
  }
}

// CRITICAL: CSS/JS assets — .next/standalone/.next/ may lack static/
// Merge root .next/static/ INTO staging/.next/static/ (don't replace)
const staticSrc = path.join(ROOT, '.next', 'static');
if (existsSync(staticSrc) && existsSync(path.join(STAGING, '.next'))) {
  const destStatic = path.join(STAGING, '.next', 'static');
  if (!existsSync(destStatic)) mkdirSync(destStatic, { recursive: true });
  cpSync(staticSrc, destStatic, { recursive: true });
  log('✓ .next/static/ merged');
}
const buildIdFile = path.join(ROOT, '.next', 'BUILD_ID');
if (existsSync(buildIdFile) && existsSync(path.join(STAGING, '.next'))) {
  cpSync(buildIdFile, path.join(STAGING, '.next', 'BUILD_ID'));
}

// Public assets (logo sprite sheets, etc.)
const publicSrc = path.join(ROOT, 'public');
if (existsSync(publicSrc)) {
  const destPublic = path.join(STAGING, 'public');
  if (!existsSync(destPublic)) mkdirSync(destPublic, { recursive: true });
  cpSync(publicSrc, destPublic, { recursive: true });
  log('✓ public/ (assets)');
}

// Electron main + preload
cpSync(path.join(ROOT, 'electron'), path.join(STAGING, 'electron'), { recursive: true });
log('✓ electron/');

// App source modules (EventBus, scheduler, etc.)
cpSync(path.join(ROOT, 'src'), path.join(STAGING, 'src'), { recursive: true });
// Strip frontend source — only server-side lib/ is needed at runtime
for (const d of ['app', 'components', 'hooks', 'types']) {
  const p = path.join(STAGING, 'src', d);
  if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); }
}
log('✓ src/ (lib only)');

// Bundle MCP server: use shared build script (DRY)
log('Bundling mcp/group-server.mjs...');
execSync(`node "${path.join(ROOT, 'scripts', 'build-mcp.mjs')}"`, { cwd: ROOT, stdio: 'pipe', timeout: 30_000 });
// The shared script writes to ROOT/mcp/group-server.mjs — copy into staging
cpSync(path.join(ROOT, 'mcp', 'group-server.mjs'), path.join(STAGING, 'mcp', 'group-server.mjs'));
log('✓ mcp/group-server.mjs (bundled)');

// Bundle WebSocket server (server.ts → server.mjs) — no tsx needed at runtime
log('Bundling server.ts → server.mjs...');
execSync(
  `npx esbuild "${path.join(ROOT, 'server.ts')}" --bundle --platform=node --format=esm ` +
  `--outfile="${path.join(STAGING, 'server.mjs')}" ` +
  `--external:fs --external:path --external:http --external:crypto ` +
  `--external:readline --external:child_process --external:os --external:ws`,
  { cwd: ROOT, stdio: 'pipe', timeout: 30_000 }
);
log('✓ server.mjs (bundled)');

// Electron module
cpSync(path.join(ROOT, 'node_modules', 'electron'),
       path.join(STAGING, 'node_modules', 'electron'), { recursive: true });
log('✓ node_modules/electron/');

// ws module (needed by WebSocket server)
cpSync(path.join(ROOT, 'node_modules', 'ws'),
       path.join(STAGING, 'node_modules', 'ws'), { recursive: true });
log('✓ node_modules/ws/');


// Claude Agent SDK (not traced by Next.js standalone)
const sdkSrc = path.join(ROOT, 'node_modules', '@anthropic-ai', 'claude-agent-sdk');
if (existsSync(sdkSrc)) {
  mkdirSync(path.join(STAGING, 'node_modules', '@anthropic-ai'), { recursive: true });
  cpSync(sdkSrc,
         path.join(STAGING, 'node_modules', '@anthropic-ai', 'claude-agent-sdk'), { recursive: true });
  log('✓ node_modules/@anthropic-ai/claude-agent-sdk/');
}

// Claude Agent SDK native binary (win32-x64) — THIS IS THE ACTUAL claude.exe
const nativeSdk = path.join(ROOT, 'node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64');
if (existsSync(nativeSdk)) {
  mkdirSync(path.join(STAGING, 'node_modules', '@anthropic-ai'), { recursive: true });
  cpSync(nativeSdk,
         path.join(STAGING, 'node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64'), { recursive: true });
  // Node.js 24+ requires a "main" field for require.resolve to find this package.
  // The SDK uses require.resolve('@anthropic-ai/claude-agent-sdk-win32-x64') to locate claude.exe.
  const np = path.join(STAGING, 'node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64', 'package.json');
  const npData = JSON.parse(readFileSync(np, 'utf-8'));
  npData.main = './claude.exe';
  writeFileSync(np, JSON.stringify(npData));
  log('✓ node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/ (claude.exe + resolution fix)');
}

// Runtime data — copy then clean staging (preserve source)
for (const d of ['Agents', 'Groups', 'mcp']) {
  const s = path.join(ROOT, d);
  const dest = path.join(STAGING, d);
  if (existsSync(s)) {
    if (existsSync(dest)) rmSync(dest, { recursive: true });
    cpSync(s, dest, { recursive: true });
    log(`✓ ${d}/ (overwritten from source)`);
  }
}

// Strip session/cache data from staging — ship clean
log('Cleaning staging data...');
for (const ad of readdirSync(path.join(STAGING, 'Agents'), { withFileTypes: true })) {
  if (!ad.isDirectory() || ad.name.startsWith('.')) continue;
  try { rmSync(path.join(STAGING, 'Agents', ad.name, 'chat'), { recursive: true, force: true }); } catch {}
  mkdirSync(path.join(STAGING, 'Agents', ad.name, 'chat'), { recursive: true });
  try { rmSync(path.join(STAGING, 'Agents', ad.name, '.auto-respond-cache.json'), { force: true }); } catch {}
}
for (const gd of readdirSync(path.join(STAGING, 'Groups'), { withFileTypes: true })) {
  if (!gd.isDirectory() || gd.name.startsWith('.')) continue;
  try { rmSync(path.join(STAGING, 'Groups', gd.name, 'chat'), { recursive: true, force: true }); } catch {}
  mkdirSync(path.join(STAGING, 'Groups', gd.name, 'chat'), { recursive: true });
}
log('✓ staging data cleaned');

// Strip frontend source from staging — only lib/ needed for server-side
for (const d of ['app', 'components', 'hooks', 'types']) {
  const p = path.join(STAGING, 'src', d);
  if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); }
}
// Also fix if standalone copied src/ at wrong level
const nestedSrc = path.join(STAGING, 'standalone', 'src');
if (existsSync(nestedSrc)) {
  for (const d of ['app', 'components', 'hooks', 'types']) {
    const p = path.join(nestedSrc, d);
    if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  }
}
log('✓ src/ stripped to lib/ only');

mkdirSync(path.join(STAGING, '.audit'), { recursive: true });
mkdirSync(path.join(STAGING, '.mind'), { recursive: true });

// ── 3. Manifest ──────────────────────────────────────────

console.log('\n[3/4] Package manifest');
const eVer = JSON.parse(
  readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf-8')
).version;

writeFileSync(path.join(STAGING, 'package.json'), JSON.stringify({
  name: 'mind-agency',
  version: '0.3.0',
  description: 'Mind Agency — Multi-Agent Collaboration Platform',
  type: 'module',
  main: './electron/main.cjs',
  devDependencies: { electron: eVer },
}, null, 2));
log(`electron ${eVer}`);

// ── 4. Package ───────────────────────────────────────────

console.log('\n[4/4] Package exe');
if (existsSync(OUT)) rmSync(OUT, { recursive: true });

const ICON_PATH = path.join(ROOT, 'electron', 'icon.ico');

try {
  execSync(
    `node node_modules/@electron/packager/bin/electron-packager.mjs "${STAGING}" "Mind Agency" --platform=win32 --arch=x64 --icon="${ICON_PATH}" --out="${OUT}" --overwrite --no-prune --no-asar`,
    { cwd: ROOT, stdio: 'inherit', timeout: 120_000 }
  );
} catch (e) {
  console.error('Build failed. Trying with npx...');
  execSync(
    `npx @electron/packager "${STAGING}" "Mind Agency" --platform=win32 --arch=x64 --icon="${ICON_PATH}" --out="${OUT}" --overwrite --no-prune --no-asar`,
    { cwd: ROOT, stdio: 'inherit', timeout: 120_000 }
  );
}

// ── Done ─────────────────────────────────────────────────

console.log('');
const exe = path.join(OUT, 'Mind Agency-win32-x64', 'Mind Agency.exe');
if (existsSync(exe)) {
  let total = 0;
  (function sum(d) {
    for (const e of readdirSync(d, { withFileTypes: true }))
      e.isFile() ? (total += statSync(path.join(d, e.name)).size) : sum(path.join(d, e.name));
  })(path.join(OUT, 'Mind Agency-win32-x64'));
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║           ✅  Build Complete!                ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`\n  📦 ${exe}`);
  console.log(`  📏 ~${Math.round(total/1048576)} MB`);
  console.log('\n  🖥️  双击 Mind Agency.exe → 原生 Windows 窗口 → Mind Agency 管理界面');
  console.log('    不需要 Node.js，不需要浏览器，开箱即用。\n');
} else {
  console.log('❌ exe 未找到，请检查上方日志');
}
