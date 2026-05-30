import { NextRequest, NextResponse } from 'next/server';
import {
  getChatHistory,
  saveChatHistory,
  buildSystemPrompt,
  type ChatMessage,
} from '@/lib/chat';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return NextResponse.json({ error: 'Invalid agent name' }, { status: 400 });
  }

  const body = await request.json();
  const userMessage = (body.message || '').trim();

  if (!userMessage) {
    return NextResponse.json({ error: 'Empty message' }, { status: 400 });
  }

  const token = process.env.ANTHROPIC_AUTH_TOKEN;
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  const model = process.env.ANTHROPIC_MODEL || 'DeepSeek-V4-Pro';

  if (!token || !baseUrl) {
    return NextResponse.json({ error: 'API not configured' }, { status: 500 });
  }

  // Build system prompt
  const systemPrompt = buildSystemPrompt(name);

  // Load chat history
  const session = getChatHistory(name);
  const now = new Date().toISOString();

  // Add user message
  session.messages.push({
    role: 'user',
    content: userMessage,
    timestamp: now,
  });

  // Build messages array for API
  const apiMessages = session.messages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  try {
    // Call DeepSeek Anthropic API
    const apiRes = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': token,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        thinking: { type: 'disabled' },
        system: systemPrompt,
        messages: apiMessages,
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('API error:', apiRes.status, errText);
      return NextResponse.json(
        { error: `API error: ${apiRes.status}` },
        { status: 502 }
      );
    }

    const data = await apiRes.json();
    // DeepSeek may return thinking + text blocks; extract the text block
    const textBlock = data?.content?.find((c: { type: string }) => c.type === 'text');
    const assistantContent = textBlock?.text || '';

    // Save assistant response to history
    session.messages.push({
      role: 'assistant',
      content: assistantContent,
      timestamp: new Date().toISOString(),
    });

    saveChatHistory(name, session);

    return NextResponse.json({
      message: assistantContent,
      role: 'assistant',
    });
  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json(
      { error: 'Failed to reach API' },
      { status: 502 }
    );
  }
}

/** GET: return chat history */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const session = getChatHistory(name);
  return NextResponse.json(session);
}

/** DELETE: clear chat history */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  saveChatHistory(name, { messages: [] });
  return NextResponse.json({ success: true });
}
