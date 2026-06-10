import { execSync } from 'child_process';
import { existsSync, mkdirSync, cpSync, rmSync } from 'fs';
import path from 'path';

const distDir = path.resolve('dist-exe');
const unpackedDir = path.join(distDir, 'win-unpacked');

console.log('[build-exe] Starting build...');

// Clean previous build
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}

// Run electron-builder with env to skip signing
const env = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  WIN_CSC_LINK: '',
  CSC_LINK: '',
};

execSync('npx electron-builder --win', { stdio: 'inherit', env });

console.log('[build-exe] Done → dist-exe/');
