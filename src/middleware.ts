/**
 * middleware.ts — Global authentication middleware for Next.js
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

const SERVER_SECRET = process.env.MIND_SERVER_SECRET || '';

// Paths that don't require authentication
const PUBLIC_PATHS = [
  '/api/health', // Health check
  '/api/system/status', // System status
  '/api/system/models', // Public info
];

/**
 * Check if authentication is required
 * Returns true if MIND_SERVER_SECRET is set or .mind/require-auth exists
 */
function isAuthRequired(): boolean {
  if (SERVER_SECRET) return true;

  // Check if auth is required via file flag
  try {
    const flagFile = path.join(process.cwd(), '.mind', 'require-auth');
    return fs.existsSync(flagFile);
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only protect API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Skip auth for public paths
  if (PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  // Check if auth is required
  if (!isAuthRequired()) {
    return NextResponse.next();
  }

  // Check Authorization header
  const authHeader = request.headers.get('authorization');
  if (!authHeader || authHeader !== `Bearer ${SERVER_SECRET}`) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
