import { NextResponse } from 'next/server';
import os from 'os';
import { DATA_DIR } from '@/lib/data-dir';

export async function GET() {
  const [load1] = os.loadavg();
  const cpuCount = os.cpus().length;
  const freeMem = os.freemem();
  const totalMem = os.totalmem();
  return NextResponse.json({
    timestamp: Date.now(),
    uptime: Math.round(process.uptime()),
    load: { load1, cpuCount, loadPercent: Math.round(load1 / cpuCount * 100) },
    memory: { free: Math.round(freeMem / 1024 / 1024), total: Math.round(totalMem / 1024 / 1024), percent: Math.round((1 - freeMem / totalMem) * 100) },
    dataDir: DATA_DIR,
    cwd: process.cwd(),
  });
}
