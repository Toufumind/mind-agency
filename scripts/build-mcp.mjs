import { execSync } from 'child_process';
import { existsSync, mkdirSync, cpSync, writeFileSync } from 'fs';
import path from 'path';

const mcpDir = path.resolve('mcp');
const outDir = path.join(mcpDir, 'mcp');

console.log('[build-mcp] Bundling MCP server...');

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

// Bundle group-server.ts → group-server.mjs
// Exclude all node_modules packages
execSync('npx esbuild mcp/group-server.ts --bundle --platform=node --format=esm --outfile=mcp/group-server.mjs --packages=external', { stdio: 'inherit' });

console.log('[build-mcp] Done → mcp/group-server.mjs');
