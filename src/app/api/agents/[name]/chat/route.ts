import { NextRequest } from 'next/server';
import { createChatStream, getChatHistory, clearChat } from '@/lib/chat';

export const dynamic = 'force-dynamic';

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
  try {
    const body = await request.json();
    message = (body.message || '').trim();
    group = (body.group || '').trim();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  if (!message) {
    return new Response(JSON.stringify({ error: 'Empty message' }), { status: 400 });
  }

  // SSE stream — pass group for context injection
  const stream = createChatStream(name, message, group || undefined);

  const sseStream = new ReadableStream({
    async start(controller) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const line = `data: ${JSON.stringify(value)}\n\n`;
          controller.enqueue(new TextEncoder().encode(line));
        }
      } catch (err) {
        const errEvt = JSON.stringify({ type: 'error', content: String(err), timestamp: new Date().toISOString() });
        controller.enqueue(new TextEncoder().encode(`data: ${errEvt}\n\n`));
      }
      controller.enqueue(new TextEncoder().encode(`data: [DONE]\n\n`));
      controller.close();
    }
  });

  return new Response(sseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
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
