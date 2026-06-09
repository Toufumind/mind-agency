import { NextRequest, NextResponse } from 'next/server';
import { getAgency } from '@/lib/agency';

// GET /api/tasks?group=X — list tasks for a group
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const group = searchParams.get('group');

  const agency = getAgency();

  if (!group) {
    // List all agents with tasks
    const agents = agency.getAgents();
    const agentsWithTasks = [];
    for (const agent of agents) {
      const tasks = await agent.loadTasks();
      if (tasks.length > 0) {
        agentsWithTasks.push(agent.name);
      }
    }
    return NextResponse.json({ groups: agentsWithTasks });
  }

  // Get tasks for a specific group (from all agents)
  const allTasks: any[] = [];
  for (const agent of agency.getAgents()) {
    const tasks = await agent.loadTasks();
    allTasks.push(...tasks.filter(t => t.workflow === group));
  }
  return NextResponse.json({ tasks: allTasks });
}

// POST /api/tasks — create a task (called by MCP tool or API)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { group, id, title, description, reward, requiredSkills, maxClaims, postedBy } = body;

    if (!group || !id || !title || !description) {
      return NextResponse.json({ error: 'group, id, title, description required' }, { status: 400 });
    }

    const agency = getAgency();
    const agentName = postedBy || 'system';

    const task = {
      runId: id,
      stepId: 'manual',
      workflow: group,
      prompt: description,
      priority: 'normal' as const,
      status: 'pending' as const,
      createdAt: Date.now(),
    };

    await agency.addTask(agentName, task);

    return NextResponse.json({ success: true, task });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PUT /api/tasks — update a task (claim, select, complete)
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { group, taskId, action, agent, message } = body;

    if (!group || !taskId || !action) {
      return NextResponse.json({ error: 'group, taskId, action required' }, { status: 400 });
    }

    const agency = getAgency();
    const agentName = agent || 'system';

    if (action === 'complete') {
      await agency.completeTask(agentName, taskId, message || 'Completed');
    } else if (action === 'cancel') {
      const proxy = agency.getAgent(agentName);
      const tasks = await proxy.loadTasks();
      const task = tasks.find(t => t.runId === taskId);
      if (task) {
        task.status = 'failed';
        task.result = 'Cancelled';
        await proxy.saveTasks();
      }
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
