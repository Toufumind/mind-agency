/**
 * rag.ts — Industrial-grade RAG system
 *
 * Components:
 * - Embedding: BGE-small-zh via @xenova/transformers
 * - Vector Store: LanceDB (local, no server needed)
 * - Chunking: 512 tokens with 50 overlap
 * - Reranking: BGE-Reranker
 */

import fs from 'fs';
import path from 'path';
import { MIND_DIR, AGENTS_DIR, GROUPS_DIR } from './data-dir';

// ── Types ────────────────────────────────────────────────

export interface RAGDocument {
  id: string;
  content: string;
  metadata: {
    source: 'memory' | 'skill' | 'knowledge' | 'group_knowledge' | 'session';
    agent?: string;
    group?: string;
    key?: string;
    fileName?: string;
    chunkIndex?: number;
    timestamp: number;
  };
}

export interface RAGResult {
  document: RAGDocument;
  score: number;
}

export interface ChunkOptions {
  maxTokens?: number;
  overlap?: number;
}

// ── Constants ────────────────────────────────────────────

const RAG_DIR = path.join(MIND_DIR, 'rag');
const LANCE_DIR = path.join(RAG_DIR, 'lance');
const MODELS_DIR = path.join(RAG_DIR, 'models');

const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxTokens: 512,
  overlap: 50,
};

const EMBEDDING_MODEL = 'Xenova/bge-small-zh-v1.5';
const RERANKER_MODEL = 'Xenova/bge-reranker-base-zh-v1.5';

const TABLE_NAME = 'mind_rag';

// ── Globals ──────────────────────────────────────────────

let embeddingPipeline: any = null;
let rerankerPipeline: any = null;
let db: any = null;
let table: any = null;

// ── Initialization ───────────────────────────────────────

async function ensureDirs(): Promise<void> {
  for (const dir of [RAG_DIR, LANCE_DIR, MODELS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

async function getEmbeddingPipeline(): Promise<any> {
  if (embeddingPipeline) return embeddingPipeline;

  try {
    const { pipeline } = await import('@xenova/transformers');
    embeddingPipeline = await pipeline('feature-extraction', EMBEDDING_MODEL, {
      cache_dir: MODELS_DIR,
    });
    console.log('[rag] Embedding model loaded:', EMBEDDING_MODEL);
    return embeddingPipeline;
  } catch (error) {
    console.warn('[rag] Failed to load embedding model, using fallback:', error);
    // Fallback: simple hash-based embedding
    return {
      async call(text: string) {
        const hash = simpleHash(text);
        return { data: hash };
      }
    };
  }
}

async function getRerankerPipeline(): Promise<any> {
  if (rerankerPipeline) return rerankerPipeline;

  try {
    const { pipeline } = await import('@xenova/transformers');
    rerankerPipeline = await pipeline('text-classification', RERANKER_MODEL, {
      cache_dir: MODELS_DIR,
    });
    console.log('[rag] Reranker model loaded:', RERANKER_MODEL);
    return rerankerPipeline;
  } catch (error) {
    console.warn('[rag] Failed to load reranker model, will skip reranking:', error);
    // Return null to indicate reranking is not available
    return null;
  }
}

// Simple hash-based embedding fallback
function simpleHash(text: string): number[] {
  const hash = new Array(384).fill(0);
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    hash[i % 384] += charCode;
  }
  // Normalize
  const norm = Math.sqrt(hash.reduce((sum, val) => sum + val * val, 0));
  return hash.map(val => val / (norm || 1));
}

async function getDb(): Promise<any> {
  if (db) return db;

  await ensureDirs();
  const lancedb = await import('@lancedb/lancedb');
  db = await lancedb.connect(LANCE_DIR);
  console.log('[rag] LanceDB initialized at:', LANCE_DIR);
  return db;
}

async function getTable(): Promise<any> {
  if (table) return table;

  const database = await getDb();

  try {
    // Try to open existing table
    table = await database.openTable(TABLE_NAME);
    console.log('[rag] Opened existing table:', TABLE_NAME);
  } catch {
    // Create new table with schema
    table = await database.createTable(TABLE_NAME, [
      {
        id: 'placeholder',
        content: 'placeholder',
        vector: new Array(384).fill(0), // BGE-small-zh produces 384-dim vectors
        source: 'memory',
        agent: '',
        group: '',
        key: '',
        fileName: '',
        chunkIndex: 0,
        timestamp: Date.now(),
      },
    ]);
    // Remove placeholder
    await table.delete('id = "placeholder"');
    console.log('[rag] Created new table:', TABLE_NAME);
  }

  return table;
}

// ── Embedding ────────────────────────────────────────────

export async function embed(text: string): Promise<number[]> {
  const pipe = await getEmbeddingPipeline();
  try {
    const output = await pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  } catch {
    // Fallback for simple hash
    return simpleHash(text);
  }
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const pipe = await getEmbeddingPipeline();
  try {
    const results: number[][] = [];

    // Process in batches of 32
    for (let i = 0; i < texts.length; i += 32) {
      const batch = texts.slice(i, i + 32);
      const output = await pipe(batch, { pooling: 'mean', normalize: true });
      for (let j = 0; j < batch.length; j++) {
        results.push(Array.from(output.data.slice(j * output.dims[1], (j + 1) * output.dims[1])));
      }
    }

    return results;
  } catch {
    // Fallback for simple hash
    return texts.map(t => simpleHash(t));
  }
}

// ── Chunking ─────────────────────────────────────────────

function estimateTokens(text: string): number {
  // Rough estimate: 1 Chinese char ≈ 2 tokens, 1 English word ≈ 1 token
  const chineseChars = (text.match(/[一-鿿]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return chineseChars * 2 + englishWords;
}

export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const { maxTokens = 512, overlap = 50 } = options;

  // Split by paragraphs first
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
  const chunks: string[] = [];
  let currentChunk = '';
  let currentTokens = 0;

  for (const paragraph of paragraphs) {
    const paragraphTokens = estimateTokens(paragraph);

    if (currentTokens + paragraphTokens > maxTokens && currentChunk) {
      chunks.push(currentChunk.trim());
      // Overlap: keep last part of current chunk
      const overlapText = currentChunk.split(/\s+/).slice(-overlap).join(' ');
      currentChunk = overlapText + '\n\n' + paragraph;
      currentTokens = estimateTokens(currentChunk);
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      currentTokens += paragraphTokens;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  // If no chunks (single paragraph), split by sentences
  if (chunks.length === 0) {
    const sentences = text.split(/[。！？.!?\n]+/).filter(s => s.trim());
    let current = '';
    for (const sentence of sentences) {
      if (estimateTokens(current + sentence) > maxTokens && current) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current.trim()) chunks.push(current.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}

// ── Document Indexing ────────────────────────────────────

export async function indexDocument(doc: RAGDocument): Promise<void> {
  const tbl = await getTable();

  // Chunk the content
  const chunks = chunkText(doc.content, DEFAULT_CHUNK_OPTIONS);

  // Generate embeddings for all chunks
  const embeddings = await embedBatch(chunks);

  // Prepare data for LanceDB
  const records = chunks.map((chunk, i) => ({
    id: `${doc.id}_chunk_${i}`,
    content: chunk,
    vector: embeddings[i],
    source: doc.metadata.source,
    agent: doc.metadata.agent || '',
    group: doc.metadata.group || '',
    key: doc.metadata.key || '',
    fileName: doc.metadata.fileName || '',
    chunkIndex: i,
    timestamp: doc.metadata.timestamp,
  }));

  // Add to table
  await tbl.add(records);

  console.log(`[rag] Indexed document ${doc.id} (${chunks.length} chunks)`);
}

export async function indexDocuments(docs: RAGDocument[]): Promise<void> {
  for (const doc of docs) {
    await indexDocument(doc);
  }
}

export async function deleteDocument(docId: string): Promise<void> {
  // Validate docId to prevent injection
  if (!/^[a-zA-Z0-9_\-:.]+$/.test(docId)) {
    throw new Error(`Invalid document ID: ${docId}`);
  }

  const tbl = await getTable();

  // Delete all chunks of this document
  await tbl.delete(`id LIKE '${docId}_chunk_%'`);

  console.log(`[rag] Deleted document ${docId}`);
}

// ── Retrieval ────────────────────────────────────────────

export async function search(
  query: string,
  options: {
    topK?: number;
    filter?: string;
    rerank?: boolean;
  } = {}
): Promise<RAGResult[]> {
  const { topK = 10, filter, rerank = true } = options;

  const tbl = await getTable();

  // Embed query
  const queryEmbedding = await embed(query);

  // Search in LanceDB
  let queryBuilder = tbl.search(queryEmbedding).limit(topK);

  // Apply filter if provided
  if (filter) {
    queryBuilder = queryBuilder.where(filter);
  }

  const results = await queryBuilder.toArray();

  // Convert to RAGResult[]
  let ragResults: RAGResult[] = results.map((row: any) => ({
    document: {
      id: row.id.replace(/_chunk_\d+$/, ''),
      content: row.content,
      metadata: {
        source: row.source,
        agent: row.agent || undefined,
        group: row.group || undefined,
        key: row.key || undefined,
        fileName: row.fileName || undefined,
        chunkIndex: row.chunkIndex,
        timestamp: row.timestamp,
      },
    },
    score: 1 - (row._distance || 0), // Convert distance to similarity
  }));

  // Rerank if enabled
  if (rerank && ragResults.length > 1) {
    ragResults = await rerankResults(query, ragResults);
  }

  return ragResults;
}

async function rerankResults(query: string, results: RAGResult[]): Promise<RAGResult[]> {
  try {
    const pipe = await getRerankerPipeline();

    // If reranker is not available, return original results
    if (!pipe) {
      return results;
    }

    // Prepare pairs for reranking
    const pairs = results.map(r => ({ text: query, text_pair: r.document.content }));

    // Get reranker scores
    const scores = await pipe(pairs, { top_k: 1 });

    // Combine with original scores
    const reranked = results.map((r, i) => ({
      ...r,
      score: scores[i].score,
    }));

    // Sort by reranker score
    reranked.sort((a, b) => b.score - a.score);

    return reranked;
  } catch (error) {
    console.warn('[rag] Reranking failed, using original order:', error);
    // Return results with original scores
    return results;
  }
}

// ── Data Source Indexing ─────────────────────────────────

export async function indexAgentMemory(agent: string): Promise<number> {
  const memDir = path.join(MIND_DIR, 'agents', agent, 'memory');
  if (!fs.existsSync(memDir)) return 0;

  const files = fs.readdirSync(memDir).filter(f => f.endsWith('.md'));
  const docs: RAGDocument[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(memDir, file), 'utf-8');
    // Parse frontmatter
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (match) {
      const key = file.replace('.md', '');
      docs.push({
        id: `memory:${agent}:${key}`,
        content: match[2].trim(),
        metadata: {
          source: 'memory',
          agent,
          key,
          timestamp: Date.now(),
        },
      });
    }
  }

  await indexDocuments(docs);
  return docs.length;
}

export async function indexAgentSkills(agent: string): Promise<number> {
  const skillsDir = path.join(AGENTS_DIR, agent, 'skills');
  if (!fs.existsSync(skillsDir)) return 0;

  const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const docs: RAGDocument[] = [];

  for (const skillName of skillDirs) {
    const promptPath = path.join(skillsDir, skillName, 'prompt.md');
    if (fs.existsSync(promptPath)) {
      const content = fs.readFileSync(promptPath, 'utf-8');
      docs.push({
        id: `skill:${agent}:${skillName}`,
        content,
        metadata: {
          source: 'skill',
          agent,
          key: skillName,
          timestamp: Date.now(),
        },
      });
    }
  }

  await indexDocuments(docs);
  return docs.length;
}

export async function indexAgentKnowledge(agent: string): Promise<number> {
  const knowledgeDir = path.join(AGENTS_DIR, agent, 'knowledge');
  if (!fs.existsSync(knowledgeDir)) return 0;

  const files = fs.readdirSync(knowledgeDir).filter(f =>
    f.endsWith('.md') || f.endsWith('.txt')
  );

  const docs: RAGDocument[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(knowledgeDir, file), 'utf-8');
    docs.push({
      id: `knowledge:${agent}:${file}`,
      content,
      metadata: {
        source: 'knowledge',
        agent,
        fileName: file,
        timestamp: Date.now(),
      },
    });
  }

  await indexDocuments(docs);
  return docs.length;
}

export async function indexGroupKnowledge(group: string): Promise<number> {
  const knowledgeDir = path.join(GROUPS_DIR, group, 'knowledge');
  if (!fs.existsSync(knowledgeDir)) return 0;

  const files = fs.readdirSync(knowledgeDir).filter(f =>
    f.endsWith('.md') || f.endsWith('.txt')
  );

  const docs: RAGDocument[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(knowledgeDir, file), 'utf-8');
    docs.push({
      id: `group_knowledge:${group}:${file}`,
      content,
      metadata: {
        source: 'group_knowledge',
        group,
        fileName: file,
        timestamp: Date.now(),
      },
    });
  }

  await indexDocuments(docs);
  return docs.length;
}

// ── Session Context ──────────────────────────────────────

export async function indexSessionContext(agent: string, messages: Array<{ role: string; content: string }>): Promise<void> {
  // Only index last N messages to avoid noise
  const recentMessages = messages.slice(-10);

  const content = recentMessages
    .map(m => `[${m.role}] ${m.content}`)
    .join('\n\n');

  const doc: RAGDocument = {
    id: `session:${agent}:${Date.now()}`,
    content,
    metadata: {
      source: 'session',
      agent,
      timestamp: Date.now(),
    },
  };

  await indexDocument(doc);
}

// ── Full Indexing ────────────────────────────────────────

export async function indexAll(agent: string, group?: string): Promise<{
  memory: number;
  skills: number;
  knowledge: number;
  groupKnowledge: number;
}> {
  const [memory, skills, knowledge, groupKnowledge] = await Promise.all([
    indexAgentMemory(agent),
    indexAgentSkills(agent),
    indexAgentKnowledge(agent),
    group ? indexGroupKnowledge(group) : Promise.resolve(0),
  ]);

  console.log(`[rag] Full index for ${agent}: memory=${memory}, skills=${skills}, knowledge=${knowledge}, group=${groupKnowledge}`);
  return { memory, skills, knowledge, groupKnowledge };
}

// ── RAG Query (Main Entry Point) ─────────────────────────

export async function ragQuery(
  agent: string,
  query: string,
  options: {
    group?: string;
    topK?: number;
    includeSession?: boolean;
    sessionMessages?: Array<{ role: string; content: string }>;
  } = {}
): Promise<string> {
  const { group, topK = 5 } = options;

  // Validate agent name to prevent injection
  if (!/^[a-zA-Z0-9_\-]+$/.test(agent)) {
    console.warn(`[rag] Invalid agent name: ${agent}`);
    return '';
  }

  // Build filter for this agent/group
  // Include: memory, skill, knowledge for this agent + group_knowledge
  const filter = `(agent = '${agent}' AND (source = 'memory' OR source = 'skill' OR source = 'knowledge')) OR source = 'group_knowledge'`;

  // Search
  const results = await search(query, {
    topK,
    filter,
    rerank: true,
  });

  if (results.length === 0) return '';

  // Format results
  const parts = results.map(r => {
    const source = r.document.metadata.source;
    const label = source === 'memory' ? '记忆'
      : source === 'skill' ? '技能'
      : source === 'knowledge' ? '知识'
      : source === 'group_knowledge' ? '群组知识'
      : '对话';

    const key = r.document.metadata.key || r.document.metadata.fileName || '';
    const prefix = key ? `[${label}: ${key}]` : `[${label}]`;

    return `${prefix} ${r.document.content.slice(0, 500)}`;
  });

  return '\n\n--- RAG Context ---\n' + parts.join('\n---\n') + '\n--- End ---';
}

// ── Cleanup ──────────────────────────────────────────────

export async function clearCollection(): Promise<void> {
  const database = await getDb();

  try {
    await database.dropTable(TABLE_NAME);
    table = null;
    console.log('[rag] Table dropped');
  } catch {
    // Table might not exist
  }
}

export async function getCollectionStats(): Promise<{
  count: number;
  sources: Record<string, number>;
}> {
  const tbl = await getTable();

  // Count rows
  const count = await tbl.countRows();

  // Get sample to count sources
  const sample = await tbl.query().limit(1000).toArray();
  const sources: Record<string, number> = {};
  for (const row of sample) {
    const source = row.source || 'unknown';
    sources[source] = (sources[source] || 0) + 1;
  }

  return { count, sources };
}
