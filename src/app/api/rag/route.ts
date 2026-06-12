/**
 * RAG API — Indexing and search management
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  indexAll,
  indexAgentMemory,
  indexAgentSkills,
  indexAgentKnowledge,
  indexGroupKnowledge,
  indexSessionContext,
  search,
  ragQuery,
  clearCollection,
  getCollectionStats,
} from '@/lib/rag';

// GET /api/rag?agent=X&query=Y — Search
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const agent = searchParams.get('agent');
    const query = searchParams.get('query');
    const group = searchParams.get('group') || undefined;
    const topK = parseInt(searchParams.get('topK') || '5');
    const action = searchParams.get('action');

    // Stats action
    if (action === 'stats') {
      const stats = await getCollectionStats();
      return NextResponse.json({ ok: true, ...stats });
    }

    if (!agent || !query) {
      return NextResponse.json(
        { ok: false, error: 'agent and query required' },
        { status: 400 }
      );
    }

    const results = await search(query, { topK, rerank: true });

    return NextResponse.json({
      ok: true,
      results: results.map(r => ({
        id: r.document.id,
        content: r.document.content.slice(0, 500),
        source: r.document.metadata.source,
        score: r.score,
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}

// POST /api/rag — Index or clear
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, agent, group, messages } = body;

    if (!action) {
      return NextResponse.json(
        { ok: false, error: 'action required' },
        { status: 400 }
      );
    }

    switch (action) {
      case 'index_all': {
        if (!agent) {
          return NextResponse.json(
            { ok: false, error: 'agent required for index_all' },
            { status: 400 }
          );
        }
        const stats = await indexAll(agent, group);
        return NextResponse.json({ ok: true, ...stats });
      }

      case 'index_memory': {
        if (!agent) {
          return NextResponse.json(
            { ok: false, error: 'agent required' },
            { status: 400 }
          );
        }
        const count = await indexAgentMemory(agent);
        return NextResponse.json({ ok: true, indexed: count });
      }

      case 'index_skills': {
        if (!agent) {
          return NextResponse.json(
            { ok: false, error: 'agent required' },
            { status: 400 }
          );
        }
        const count = await indexAgentSkills(agent);
        return NextResponse.json({ ok: true, indexed: count });
      }

      case 'index_knowledge': {
        if (!agent) {
          return NextResponse.json(
            { ok: false, error: 'agent required' },
            { status: 400 }
          );
        }
        const count = await indexAgentKnowledge(agent);
        return NextResponse.json({ ok: true, indexed: count });
      }

      case 'index_group_knowledge': {
        if (!group) {
          return NextResponse.json(
            { ok: false, error: 'group required' },
            { status: 400 }
          );
        }
        const count = await indexGroupKnowledge(group);
        return NextResponse.json({ ok: true, indexed: count });
      }

      case 'index_session': {
        if (!agent || !messages) {
          return NextResponse.json(
            { ok: false, error: 'agent and messages required' },
            { status: 400 }
          );
        }
        await indexSessionContext(agent, messages);
        return NextResponse.json({ ok: true });
      }

      case 'clear': {
        await clearCollection();
        return NextResponse.json({ ok: true, message: 'Collection cleared' });
      }

      default:
        return NextResponse.json(
          { ok: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
