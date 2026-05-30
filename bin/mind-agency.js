#!/usr/bin/env node

/**
 * Mind Agency CLI
 * 启动 Agent 公司管理界面
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

console.log(`
  ╔══════════════════════════════════════╗
  ║         🏢  Mind Agency              ║
  ║     Agent Company Management          ║
  ╚══════════════════════════════════════╝
`);

console.log('  Starting Mind Agency server...\n');

const child = spawn('npx', ['next', 'dev', projectRoot], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    NODE_ENV: 'development',
  },
});

child.on('error', (err) => {
  console.error('  Failed to start server:', err.message);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
