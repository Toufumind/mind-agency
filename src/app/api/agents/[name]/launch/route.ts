import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import path from 'path';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const agentDir = path.join(process.cwd(), 'Agents', name);

  // Validate agent name (prevent path traversal)
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return NextResponse.json({ error: '无效的 Agent 名称' }, { status: 400 });
  }

  const fs = await import('fs');
  if (!fs.existsSync(agentDir)) {
    return NextResponse.json({ error: `Agent "${name}" 不存在` }, { status: 404 });
  }

  // Build launch command
  const isWindows = process.platform === 'win32';
  let command: string;

  if (isWindows) {
    // Windows: open new cmd window
    command = `start "Mind Agency - ${name}" cmd /k "cd /d ${agentDir} && claude-deepseek-zhijiao"`;
  } else if (process.platform === 'darwin') {
    // macOS: open new Terminal window
    command = `osascript -e 'tell app "Terminal" to do script "cd ${agentDir} && claude-deepseek-zhijiao"'`;
  } else {
    // Linux: try common terminals
    command = `gnome-terminal --working-directory="${agentDir}" -- claude-deepseek-zhijiao 2>/dev/null || x-terminal-emulator -e "cd ${agentDir} && claude-deepseek-zhijiao" 2>/dev/null || echo "unsupported"`;
  }

  exec(command, (error) => {
    if (error) {
      console.error(`Failed to launch agent ${name}:`, error.message);
    }
  });

  return NextResponse.json({
    success: true,
    message: `${name} 的终端已启动`,
    directory: agentDir,
  });
}
