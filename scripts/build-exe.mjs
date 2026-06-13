import { execSync } from 'child_process';
import { existsSync, mkdirSync, cpSync, rmSync, writeFileSync } from 'fs';
import path from 'path';

const distDir = path.resolve('dist-exe');
const appDir = path.join(distDir, 'Mind-Agency-win32-x64');

console.log('[build-exe] Starting electron-packager build...');

// Clean
if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });

// Package with electron-packager (skips native module rebuild for asar)
execSync(
  'npx electron-packager . Mind-Agency --platform=win32 --arch=x64 ' +
  '--out=dist-exe --overwrite --asar ' +
  '--ignore="node_modules/better-sqlite3/build,node_modules/better-sqlite3/prebuilds,.git,dist-exe,landing,scripts,.mind"',
  { stdio: 'inherit' }
);

// Copy standalone Next.js build to app — use shell cp for reliability
const standaloneDir = path.join(appDir, '.next-server');
if (existsSync(standaloneDir)) rmSync(standaloneDir, { recursive: true, force: true });

// Use shell cp -r which handles Windows correctly
execSync(`cp -r "${path.resolve('.next/standalone')}" "${standaloneDir}"`, { stdio: 'inherit' });
execSync(`cp -r "${path.resolve('.next/static')}" "${standaloneDir}/.next/static"`, { stdio: 'inherit' });
execSync(`cp -r "${path.resolve('public')}" "${standaloneDir}/public"`, { stdio: 'inherit' });

// Write a start script
writeFileSync(path.join(appDir, 'start-server.bat'),
  '@echo off\n' +
  'set DATA_DIR=%USERPROFILE%\\.mind-agency\n' +
  'if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"\n' +
  'set PORT=3000\n' +
  'node "%~dp0\\.next-server\\server.js"\n'
);

console.log('[build-exe] Done → dist-exe/Mind-Agency-win32-x64/');
