/**
 * Health check endpoint — no authentication required
 */

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { MIND_DIR, AGENTS_DIR, GROUPS_DIR } from '@/lib/data-dir';

export const dynamic = 'force-dynamic';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    filesystem: 'ok' | 'error';
    agents: 'ok' | 'error';
    groups: 'ok' | 'error';
    rag: 'ok' | 'error' | 'not_configured';
  };
  stats: {
    agents: number;
    groups: number;
    memoryUsage: NodeJS.MemoryUsage;
  };
}

export async function GET() {
  const startTime = Date.now();

  try {
    // Check filesystem access
    let filesystemStatus: 'ok' | 'error' = 'ok';
    try {
      fs.accessSync(MIND_DIR, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
      filesystemStatus = 'error';
    }

    // Check agents directory
    let agentsStatus: 'ok' | 'error' = 'ok';
    let agentCount = 0;
    try {
      if (fs.existsSync(AGENTS_DIR)) {
        const agents = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
          .filter(d => d.isDirectory() && !d.name.startsWith('.'));
        agentCount = agents.length;
      }
    } catch {
      agentsStatus = 'error';
    }

    // Check groups directory
    let groupsStatus: 'ok' | 'error' = 'ok';
    let groupCount = 0;
    try {
      if (fs.existsSync(GROUPS_DIR)) {
        const groups = fs.readdirSync(GROUPS_DIR, { withFileTypes: true })
          .filter(d => d.isDirectory() && !d.name.startsWith('.'));
        groupCount = groups.length;
      }
    } catch {
      groupsStatus = 'error';
    }

    // Check RAG availability
    let ragStatus: 'ok' | 'error' | 'not_configured' = 'not_configured';
    try {
      const ragDir = path.join(MIND_DIR, 'rag');
      if (fs.existsSync(ragDir)) {
        ragStatus = 'ok';
      }
    } catch {
      ragStatus = 'error';
    }

    // Determine overall status
    const checks = {
      filesystem: filesystemStatus,
      agents: agentsStatus,
      groups: groupsStatus,
      rag: ragStatus,
    };

    const hasError = Object.values(checks).some(v => v === 'error');
    const status = hasError ? 'unhealthy' : 'healthy';

    const result: HealthStatus = {
      status,
      timestamp: new Date().toISOString(),
      version: '0.8.0',
      uptime: process.uptime(),
      checks,
      stats: {
        agents: agentCount,
        groups: groupCount,
        memoryUsage: process.memoryUsage(),
      },
    };

    return NextResponse.json(result, {
      status: status === 'healthy' ? 200 : 503,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message,
      },
      { status: 503 }
    );
  }
}
