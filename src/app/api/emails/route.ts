import { NextRequest, NextResponse } from 'next/server';
import { getAgentEmails, getEmail } from '@/lib/agents';
import { sendEmail, deleteEmail } from '@/lib/emails';
import { broadcastWs } from '@/lib/ws-embedded';
import { pollAllAgents } from '@/lib/auto-respond';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agent = searchParams.get('agent');
    const file = searchParams.get('file');
    if (!agent) return NextResponse.json({ error: '缺少 agent' }, { status: 400 });
    if (file) {
      const email = getEmail(agent, file);
      if (!email) return NextResponse.json({ error: '邮件不存在' }, { status: 404 });
      return NextResponse.json(email);
    }
    const emails = getAgentEmails(agent);
    return NextResponse.json(emails);
  } catch {
    return NextResponse.json({ error: 'Failed to load emails' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { from, to, subject, body: emailBody, content } = body;
    if (!from || !to) return NextResponse.json({ error: '缺少必填字段 from/to' }, { status: 400 });
    const result = sendEmail({ from, to, subject: subject || '(no subject)', body: emailBody || content || '' });
    if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
    // Fire-and-forget: trigger auto-respond immediately, don't block response
    pollAllAgents().catch(() => {});

    broadcastWs('email', { to, from, subject: subject || '(no subject)' });
    return NextResponse.json({ success: true, filename: result.filename, message: `已发送给 ${to}` });
  } catch { return NextResponse.json({ error: '请求格式错误' }, { status: 400 }); }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agent = searchParams.get('agent');
    const file = searchParams.get('file');
    if (!agent || !file) return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    const result = deleteEmail(agent, file);
    if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ success: true, message: '已删除' });
  } catch {
    return NextResponse.json({ error: 'Failed to delete email' }, { status: 500 });
  }
}
