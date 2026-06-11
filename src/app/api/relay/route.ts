/**
 * POST /api/relay — AI API relay with RAG + token billing
 *
 * Agents call this instead of directly calling AI providers.
 * Flow: Agent → Relay → RAG → AI Provider → Track tokens → Return
 */

import { NextRequest, NextResponse } from 'next/server';
import { relay } from '@/lib/relay';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agent, messages, model, maxTokens } = body;

    if (!agent || !messages) {
      return NextResponse.json({ error: 'agent and messages required' }, { status: 400 });
    }

    const result = await relay({ agent, messages, model, maxTokens });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[relay] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
