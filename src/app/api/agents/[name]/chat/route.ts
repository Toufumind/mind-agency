import { NextRequest, NextResponse } from 'next/server';
import { chatWithAgent, getChatHistory, clearChat } from '@/lib/chat';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return NextResponse.json({ error: 'Invalid agent name' }, { status: 400 });
  }
  try {
    const body = await request.json();
    const userMessage = (body.message || '').trim();
    if (!userMessage) {
      return NextResponse.json({ error: 'Empty message' }, { status: 400 });
    }
    const { reply, events } = await chatWithAgent(name, userMessage);
    return NextResponse.json({ message: reply, events, role: 'assistant' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[chat:${name}]`, msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  return NextResponse.json(getChatHistory(name));
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  clearChat(name);
  return NextResponse.json({ success: true });
}
