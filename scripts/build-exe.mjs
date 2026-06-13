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
  '--out=dist-exe --overwrite --asar --ignore="node_modules/better-sqlite3/build" ' +
  '--ignore="node_modules/better-sqlite3/prebuilds" ' +
  '--ignore="\\.git" --ignore="dist-exe" --ignore="landing" --ignore="scripts" ' +
  '--ignore="Groups" --ignore="Agents" --ignore="\\.mind"',
  { stdio: 'inherit' }
);

// Copy standalone Next.js build to app
const standaloneDir = path.join(appDir, '.next-server');
if (!existsSync(standaloneDir)) mkdirSync(standaloneDir, { recursive: true });
cpSync(path.resolve('.next/standalone'), standaloneDir, { recursive: true });
cpSync(path.resolve('.next/static'), path.join(standaloneDir, '.next/static'), { recursive: true });
cpSync(path.resolve('public'), path.join(standaloneDir, 'public'), { recursive: true });

// Write a start script
writeFileSync(path.join(appDir, 'start-server.bat'),
  '@echo off\n' +
  'set DATA_DIR=%USERPROFILE%\\.mind-agency\n' +
  'if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"\n' +
  'set PORT=3000\n' +
  'node "%~dp0\\.next-server\\server.js"\n'
);

console.log('[build-exe] Done → dist-exe/Mind-Agency-win32-x64/');
