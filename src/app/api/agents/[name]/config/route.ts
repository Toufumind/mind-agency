import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return NextResponse.json({ error: 'Invalid name' }, { status: 400 });

  const cfgFile = path.join(process.cwd(), 'Agents', name, 'config.json');
  if (!fs.existsSync(cfgFile)) {
    // Return defaults
    return NextResponse.json({
      autoRespondToEmail: false,
      autoProcessGroupInvites: false,
      notifyOnEmail: true,
      notifyOnGroupMention: true,
    });
  }
  try {
    return NextResponse.json(JSON.parse(fs.readFileSync(cfgFile, 'utf-8')));
  } catch {
    return NextResponse.json({ error: 'Invalid config' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return NextResponse.json({ error: 'Invalid name' }, { status: 400 });

  const agentDir = path.join(process.cwd(), 'Agents', name);
  if (!fs.existsSync(agentDir)) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  try {
    const body = await request.json();
    const cfgFile = path.join(agentDir, 'config.json');
    const existing = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf-8')) : {};
    const merged = { ...existing, ...body };
    fs.writeFileSync(cfgFile, JSON.stringify(merged, null, 2), 'utf-8');
    return NextResponse.json(merged);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
}
