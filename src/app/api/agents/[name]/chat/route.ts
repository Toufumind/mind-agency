import { NextRequest } from 'next/server';
import { createChatStream, getChatHistory, clearChat } from '@/lib/chat';
import { writeAudit } from '@/lib/audit';
import { handleCliCommand } from '@/lib/cli-commands';

export const dynamic = 'force-dynamic';

// ── Idempotency cache: same agent + same message within 10s → replay cached SSE ──
const sseCache = new Map<string, { chunks: string[]; ts: number }>();
const SSE_CACHE_TTL = 10_000;

/** Periodically purge expired cache entries */
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sseCache) {
    if (now - v.ts > SSE_CACHE_TTL) sseCache.delete(k);
  }
}, 15_000).unref?.();

const sseHeaders = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
};

function replaySSE(chunks: string[]): Response {
  let i = 0;
  const body = new ReadableStream({
    pull(ctrl) {
      if (i < chunks.length) {
        ctrl.enqueue(new TextEncoder().encode(chunks[i++]));
      } else {
        ctrl.close();
      }
    },
  });
  return new Response(body, { headers: sseHeaders });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return new Response(JSON.stringify({ error: 'Invalid agent name' }), { status: 400 });
  }

  let message = '';
  let group = '';
  let model = '';
  let fresh = false;
  try {
    const body = await request.json();
    message = (body.message || '').trim();
    group = (body.group || '').trim();
    model = (body.model || '').trim();
    fresh = body.fresh === true;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  if (!message) {
    return new Response(JSON.stringify({ error: 'Empty message' }), { status: 400 });
  }

  // ── Idempotency check ──
  const cacheKey = `${name}::${group}::${model}::${fresh}::${message}`;
  const cached = sseCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < SSE_CACHE_TTL) {
    return replaySSE(cached.chunks);
  }

  // ── CLI command handling (e.g. /goal, /plan, /rename) ──
  const history = getChatHistory(name);
  const sessionId = history.sessionId || '';
  const cliResult = handleCliCommand(name, message, sessionId);
  if (cliResult.handled) {
    // Direct reply (like /goal confirm, /rename confirm)
    // Wrapped as SSE so the frontend's existing stream handler consumes it.
    if (cliResult.directReply) {
      const sseBody = `data: ${JSON.stringify({ type: 'text', content: cliResult.directReply, timestamp: new Date().toISOString() })}\n\ndata: [DONE]\n\n`;
      return new Response(sseBody, { headers: sseHeaders });
    }
    // Commands with optsOverrides (like /plan) — continue to stream with overrides
  }

  // Audit log
  writeAudit({
    agent: name,
    action: 'chat.message',
    resource: group ? `group:${group}` : `agent:${name}`,
    details: message.slice(0, 200),
  });

  // SSE stream — pass group/model/overrides/fresh
  const stream = createChatStream(name, message, group || undefined, model || undefined, cliResult.optsOverrides, fresh);

  // Buffer SSE chunks for caching (lazily, only if the stream completes)
  const chunks: string[] = [];

  const sseStream = new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const line = `data: ${JSON.stringify(value)}\n\n`;
          chunks.push(line);
          controller.enqueue(new TextEncoder().encode(line));
        }
      } catch (err) {
        const errEvt = JSON.stringify({ type: 'error', content: String(err), timestamp: new Date().toISOString() });
        chunks.push(`data: ${errEvt}\n\n`);
        controller.enqueue(new TextEncoder().encode(`data: ${errEvt}\n\n`));
      }
      const doneLine = `data: [DONE]\n\n`;
      chunks.push(doneLine);
      controller.enqueue(new TextEncoder().encode(doneLine));
      controller.close();
      // Cache completed response for idempotent replay
      sseCache.set(cacheKey, { chunks, ts: Date.now() });
    }
  });

  return new Response(sseStream, { headers: sseHeaders });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  return Response.json(getChatHistory(name));
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  clearChat(name);
  return Response.json({ success: true });
}
