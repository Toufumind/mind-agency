import { NextRequest, NextResponse } from 'next/server';
import { getAgentEmails, getEmail } from '@/lib/agents';
import { sendEmail, deleteEmail } from '@/lib/emails';

/** GET: 获取邮件列表或单封邮件 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const agent = searchParams.get('agent');
  const file = searchParams.get('file');

  if (!agent) {
    return NextResponse.json({ error: '缺少 agent 参数' }, { status: 400 });
  }

  // 读取单封邮件
  if (file) {
    const email = getEmail(agent, file);
    if (!email) {
      return NextResponse.json({ error: '邮件不存在' }, { status: 404 });
    }
    return NextResponse.json(email);
  }

  // 列出收件箱
  const emails = getAgentEmails(agent);
  return NextResponse.json(emails);
}

/** POST: 发送邮件 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { from, to, subject, body: emailBody } = body;

    if (!from || !to || !subject) {
      return NextResponse.json(
        { error: '缺少必填字段: from, to, subject' },
        { status: 400 }
      );
    }

    const result = sendEmail({ from, to, subject, body: emailBody || '' });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      filename: result.filename,
      message: `邮件已发送给 ${to}`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: '请求格式错误' },
      { status: 400 }
    );
  }
}

/** DELETE: 删除邮件 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const agent = searchParams.get('agent');
  const file = searchParams.get('file');

  if (!agent || !file) {
    return NextResponse.json({ error: '缺少 agent 或 file 参数' }, { status: 400 });
  }

  const result = deleteEmail(agent, file);

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true, message: '邮件已删除' });
}
