# RAG Optimization for Agent Memory Systems

## Executive Summary

This document outlines optimization strategies for Mind Agency's RAG (Retrieval-Augmented Generation) system, focusing on local semantic search in agent memory systems. The design improves retrieval accuracy, reduces latency, and enhances the overall quality of context provided to agents.

## Current State Analysis

### Existing Implementation (`rag.ts` + `embedding.ts`)

**Strengths:**
- Local BGE-small-zh embedding model (384-dim)
- LanceDB for persistent vector storage
- SimHash + TF-IDF hybrid scoring (60/40)
- Reranking with BGE-reranker
- Chunking with 512 tokens + 50 overlap

**Gaps:**
- No BM25/keyword search integration
- No query transformation (HyDE, multi-query)
- Limited caching strategy
- No semantic chunking option
- No evaluation metrics

## Proposed Optimization Architecture

### 1. Hybrid Search (BM25 + Vector)

**Inspired by:** Reciprocal Rank Fusion (RRF) research

```typescript
interface HybridSearchConfig {
  // Scoring weights
  vectorWeight: number;  // Default: 0.6
  bm25Weight: number;    // Default: 0.4
  
  // RRF parameters
  rrfK: number;  // Default: 60
  
  // Search modes
  mode: 'rrf' | 'linear' | 'vector_only' | 'bm25_only';
}

interface SearchResult {
  document: RAGDocument;
  vectorScore: number;
  bm25Score: number;
  combinedScore: number;
  rank: number;
}
```

**Implementation:**

```typescript
// Reciprocal Rank Fusion
function rrfScore(rank: number, k: number = 60): number {
  return 1 / (k + rank);
}

// Hybrid scoring
function hybridScore(
  vectorRank: number,
  bm25Rank: number,
  config: HybridSearchConfig
): number {
  if (config.mode === 'rrf') {
    return rrfScore(vectorRank, config.rrfK) + rrfScore(bm25Rank, config.rrfK);
  }
  
  // Linear combination
  return config.vectorWeight * (1 / (vectorRank + 1)) +
         config.bm25Weight * (1 / (bm25Rank + 1));
}
```

**Benefits:**
- BM25 handles exact keyword matches (model names, error codes, function names)
- Vector search handles semantic similarity (concepts, paraphrases)
- RRF merges results without score normalization issues

### 2. BM25 Implementation

```typescript
class BM25Index {
  private docFreq: Map<string, number> = new Map();
  private termFreqs: Map<string, Map<string, number>> = new Map();
  private docLengths: Map<string, number> = new Map();
  private avgDocLength: number = 0;
  
  // BM25 parameters
  private k1: number = 1.5;
  private b: number = 0.75;
  
  addDocument(docId: string, text: string): void {
    const tokens = this.tokenize(text);
    this.docLengths.set(docId, tokens.length);
    
    // Calculate term frequencies
    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }
    this.termFreqs.set(docId, tf);
    
    // Update document frequency
    for (const token of new Set(tokens)) {
      this.docFreq.set(token, (this.docFreq.get(token) || 0) + 1);
    }
    
    // Update average document length
    this.avgDocLength = Array.from(this.docLengths.values())
      .reduce((a, b) => a + b, 0) / this.docLengths.size;
  }
  
  search(query: string, topK: number = 10): Array<{ docId: string; score: number }> {
    const queryTokens = this.tokenize(query);
    const scores: Array<{ docId: string; score: number }> = [];
    
    for (const [docId, tf] of this.termFreqs) {
      let score = 0;
      const docLength = this.docLengths.get(docId) || 0;
      
      for (const token of queryTokens) {
        const termFreq = tf.get(token) || 0;
        const docFreq = this.docFreq.get(token) || 0;
        const n = this.docLengths.size;
        
        // IDF component
        const idf = Math.log((n - docFreq + 0.5) / (docFreq + 0.5) + 1);
        
        // TF component with length normalization
        const tfNorm = (termFreq * (this.k1 + 1)) /
          (termFreq + this.k1 * (1 - this.b + this.b * docLength / this.avgDocLength));
        
        score += idf * tfNorm;
      }
      
      scores.push({ docId, score });
    }
    
    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
  
  private tokenize(text: string): string[] {
    const lower = text.toLowerCase();
    const tokens: string[] = [];
    
    // English words
    for (const w of lower.match(/[a-z0-9_]+/g) || []) {
      tokens.push(w);
    }
    
    // Chinese character bigrams
    const cn = lower.match(/[一-鿿]+/g) || [];
    for (const phrase of cn) {
      for (let i = 0; i <= phrase.length - 2; i++) {
        tokens.push(phrase.slice(i, i + 2));
      }
      // Also add individual characters
      for (const ch of phrase) {
        tokens.push(ch);
      }
    }
    
    return tokens;
  }
}
```

### 3. Query Transformation

**HyDE (Hypothetical Document Embeddings):**

```typescript
async function hydeQuery(
  query: string,
  llm: LLM
): Promise<string> {
  const prompt = `Generate a hypothetical answer to this question. The answer should be detailed and informative.

Question: ${query}

Hypothetical Answer:`;
  
  const response = await llm.complete(prompt);
  return response.text;
}

// Usage
const hydeQueryEmbedding = await embed(await hydeQuery(query, llm));
```

**Multi-Query Generation:**

```typescript
async function generateMultiQueries(
  query: string,
  llm: LLM,
  numQueries: number = 3
): Promise<string[]> {
  const prompt = `Generate ${numQueries} different versions of this query to retrieve relevant documents. Each version should approach the topic from a different angle.

Original Query: ${query}

Generated Queries:
1.`;
  
  const response = await llm.complete(prompt);
  const queries = response.text.split('\n')
    .filter(line => line.match(/^\d+\./))
    .map(line => line.replace(/^\d+\.\s*/, ''));
  
  return [query, ...queries];
}

// Usage with RRF
const queries = await generateMultiQueries(query, llm);
const allResults = await Promise.all(
  queries.map(q => hybridSearch(q, topK * 2))
);
const mergedResults = rrfMerge(allResults, topK);
```

### 4. Advanced Chunking Strategies

**Semantic Chunking:**

```typescript
async function semanticChunk(
  text: string,
  embedFn: (text: string) => Promise<number[]>,
  threshold: number = 0.3
): Promise<string[]> {
  const sentences = splitIntoSentences(text);
  const embeddings = await Promise.all(sentences.map(embedFn));
  
  const chunks: string[] = [];
  let currentChunk: string[] = [sentences[0]];
  
  for (let i = 1; i < sentences.length; i++) {
    const similarity = cosineSimilarity(embeddings[i - 1], embeddings[i]);
    
    if (similarity < threshold) {
      // Semantic break detected
      chunks.push(currentChunk.join(' '));
      currentChunk = [sentences[i]];
    } else {
      currentChunk.push(sentences[i]);
    }
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '));
  }
  
  return chunks;
}
```

**Hierarchical Chunking:**

```typescript
interface HierarchicalChunk {
  id: string;
  content: string;
  parent?: string;
  children: string[];
  metadata: {
    level: 'section' | 'paragraph' | 'sentence';
    index: number;
  };
}

function hierarchicalChunk(text: string): HierarchicalChunk[] {
  const chunks: HierarchicalChunk[] = [];
  
  // Level 1: Sections (by headers)
  const sections = text.split(/\n(?=#{1,3}\s)/);
  sections.forEach((section, sectionIdx) => {
    const sectionChunk: HierarchicalChunk = {
      id: `section_${sectionIdx}`,
      content: section,
      children: [],
      metadata: { level: 'section', index: sectionIdx },
    };
    chunks.push(sectionChunk);
    
    // Level 2: Paragraphs
    const paragraphs = section.split(/\n\n+/);
    paragraphs.forEach((paragraph, paraIdx) => {
      const paraChunk: HierarchicalChunk = {
        id: `section_${sectionIdx}_para_${paraIdx}`,
        content: paragraph,
        parent: sectionChunk.id,
        children: [],
        metadata: { level: 'paragraph', index: paraIdx },
      };
      chunks.push(paraChunk);
      sectionChunk.children.push(paraChunk.id);
    });
  });
  
  return chunks;
}
```

### 5. Enhanced Caching Strategy

```typescript
class RAGCache {
  private queryCache: Map<string, CacheEntry> = new Map();
  private embeddingCache: Map<string, number[]> = new Map();
  
  private maxQueryCacheSize: number = 1000;
  private maxEmbeddingCacheSize: number = 10000;
  private ttl: number = 3600000; // 1 hour
  
  getQueryResult(query: string, topK: number): RAGResult[] | null {
    const key = this.getQueryKey(query, topK);
    const entry = this.queryCache.get(key);
    
    if (entry && Date.now() - entry.timestamp < this.ttl) {
      return entry.results;
    }
    
    return null;
  }
  
  setQueryResult(query: string, topK: number, results: RAGResult[]): void {
    const key = this.getQueryKey(query, topK);
    
    // Evict oldest if at capacity
    if (this.queryCache.size >= this.maxQueryCacheSize) {
      const oldestKey = Array.from(this.queryCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
      this.queryCache.delete(oldestKey);
    }
    
    this.queryCache.set(key, {
      results,
      timestamp: Date.now(),
    });
  }
  
  getEmbedding(text: string): number[] | null {
    const hash = this.hashText(text);
    return this.embeddingCache.get(hash) || null;
  }
  
  setEmbedding(text: string, embedding: number[]): void {
    const hash = this.hashText(text);
    
    // Evict oldest if at capacity
    if (this.embeddingCache.size >= this.maxEmbeddingCacheSize) {
      const firstKey = this.embeddingCache.keys().next().value;
      this.embeddingCache.delete(firstKey);
    }
    
    this.embeddingCache.set(hash, embedding);
  }
  
  private getQueryKey(query: string, topK: number): string {
    return `${query}:${topK}`;
  }
  
  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash.toString(36);
  }
}
```

### 6. Metadata Pre-filtering

```typescript
interface SearchFilter {
  source?: string[];
  agent?: string;
  group?: string;
  dateRange?: {
    start: number;
    end: number;
  };
}

async function filteredSearch(
  query: string,
  filter: SearchFilter,
  topK: number = 10
): Promise<RAGResult[]> {
  // Pre-filter by metadata before vector search
  const filteredDocs = filterDocuments(filter);
  
  // Build filtered index
  const filteredIndex = buildFilteredIndex(filteredDocs);
  
  // Search within filtered set
  return hybridSearch(query, topK, filteredIndex);
}

function filterDocuments(filter: SearchFilter): RAGDocument[] {
  return allDocuments.filter(doc => {
    if (filter.source && !filter.source.includes(doc.metadata.source)) {
      return false;
    }
    if (filter.agent && doc.metadata.agent !== filter.agent) {
      return false;
    }
    if (filter.group && doc.metadata.group !== filter.group) {
      return false;
    }
    if (filter.dateRange) {
      if (doc.metadata.timestamp < filter.dateRange.start ||
          doc.metadata.timestamp > filter.dateRange.end) {
        return false;
      }
    }
    return true;
  });
}
```

### 7. Evaluation Metrics (RAGAS-inspired)

```typescript
interface RAGMetrics {
  // Retrieval metrics
  precisionAtK: number;      // Relevant docs in top-K
  recallAtK: number;         // Relevant docs retrieved / total relevant
  mrr: number;               // Mean Reciprocal Rank
  ndcg: number;              // Normalized Discounted Cumulative Gain
  
  // Generation metrics (if applicable)
  faithfulness: number;      // Answer grounded in context
  relevancy: number;         // Answer addresses query
  
  // Performance metrics
  latencyMs: number;
  indexSize: number;
}

async function evaluateRAG(
  testQueries: Array<{ query: string; relevantDocs: string[] }>,
  searchFn: (query: string) => Promise<RAGResult[]>
): Promise<RAGMetrics> {
  const metrics = {
    precisionAtK: 0,
    recallAtK: 0,
    mrr: 0,
    ndcg: 0,
    faithfulness: 0,
    relevancy: 0,
    latencyMs: 0,
    indexSize: 0,
  };
  
  for (const { query, relevantDocs } of testQueries) {
    const startTime = Date.now();
    const results = await searchFn(query);
    const latency = Date.now() - startTime;
    
    // Precision@K
    const relevantRetrieved = results.filter(r => 
      relevantDocs.includes(r.document.id)
    ).length;
    metrics.precisionAtK += relevantRetrieved / results.length;
    
    // Recall@K
    metrics.recallAtK += relevantRetrieved / relevantDocs.length;
    
    // MRR
    const firstRelevantRank = results.findIndex(r => 
      relevantDocs.includes(r.document.id)
    ) + 1;
    if (firstRelevantRank > 0) {
      metrics.mrr += 1 / firstRelevantRank;
    }
    
    // NDCG
    const gains = results.map((r, i) => 
      relevantDocs.includes(r.document.id) ? 1 / Math.log2(i + 2) : 0
    );
    const idealGains = relevantDocs.map((_, i) => 1 / Math.log2(i + 2));
    const dcg = gains.reduce((a, b) => a + b, 0);
    const idcg = idealGains.reduce((a, b) => a + b, 0);
    metrics.ndcg += dcg / idcg;
    
    metrics.latencyMs += latency;
  }
  
  const n = testQueries.length;
  return {
    precisionAtK: metrics.precisionAtK / n,
    recallAtK: metrics.recallAtK / n,
    mrr: metrics.mrr / n,
    ndcg: metrics.ndcg / n,
    faithfulness: 0,  // Requires LLM evaluation
    relevancy: 0,     // Requires LLM evaluation
    latencyMs: metrics.latencyMs / n,
    indexSize: allDocuments.length,
  };
}
```

## Implementation Phases

### Phase 1: BM25 Integration (Week 1-2)

1. **BM25 Index Implementation**
   - Create BM25Index class
   - Integrate with existing search

2. **Hybrid Scoring**
   - Implement RRF merging
   - Add configurable weights

3. **Basic Caching**
   - Query result caching
   - Embedding caching

### Phase 2: Query Transformation (Week 3-4)

1. **HyDE Implementation**
   - Generate hypothetical answers
   - Embed and search

2. **Multi-Query Generation**
   - Generate query variations
   - Merge results with RRF

3. **Metadata Pre-filtering**
   - Filter by source/agent/group
   - Date range filtering

### Phase 3: Advanced Chunking (Week 5-6)

1. **Semantic Chunking**
   - Sentence-level splitting
   - Similarity-based breaks

2. **Hierarchical Indexing**
   - Section/paragraph structure
   - Parent-child relationships

3. **Evaluation Framework**
   - RAGAS metrics implementation
   - Test query dataset

## Performance Targets

| Metric | Current | Target | Improvement |
|--------|---------|--------|-------------|
| Precision@5 | Unknown | >0.7 | Establish baseline |
| Recall@10 | Unknown | >0.8 | Establish baseline |
| MRR | Unknown | >0.6 | Establish baseline |
| Query Latency | Unknown | <200ms | Optimize |
| Index Update Time | Unknown | <1s/doc | Optimize |

## Integration with Existing Systems

### Memory System (`memory.ts`)

```typescript
// Enhanced searchMemory with hybrid search
export async function searchMemory(
  agentName: string,
  query: string,
  options: {
    useHybrid?: boolean;
    useHyde?: boolean;
    filter?: SearchFilter;
  } = {}
): Promise<MemoryEntry[]> {
  const { useHybrid = true, useHyde = false, filter } = options;
  
  if (useHyde) {
    query = await hydeQuery(query, getLLM());
  }
  
  if (useHybrid) {
    return hybridSearchMemory(agentName, query, filter);
  }
  
  // Fallback to existing implementation
  return existingSearchMemory(agentName, query);
}
```

### RAG System (`rag.ts`)

```typescript
// Enhanced search with all optimizations
export async function search(
  query: string,
  options: {
    topK?: number;
    filter?: string;
    rerank?: boolean;
    useHybrid?: boolean;
    useHyde?: boolean;
    useMultiQuery?: boolean;
  } = {}
): Promise<RAGResult[]> {
  const {
    topK = 10,
    filter,
    rerank = true,
    useHybrid = true,
    useHyde = false,
    useMultiQuery = false,
  } = options;
  
  let queries = [query];
  
  if (useHyde) {
    queries = [await hydeQuery(query, getLLM())];
  }
  
  if (useMultiQuery) {
    queries = await generateMultiQueries(query, getLLM());
  }
  
  let allResults: RAGResult[] = [];
  
  for (const q of queries) {
    const results = useHybrid
      ? await hybridSearch(q, topK * 2, filter)
      : await vectorSearch(q, topK * 2, filter);
    allResults = allResults.concat(results);
  }
  
  // Merge with RRF
  const mergedResults = rrfMerge(allResults, topK);
  
  // Rerank if enabled
  if (rerank && mergedResults.length > 1) {
    return rerankResults(query, mergedResults);
  }
  
  return mergedResults;
}
```

### MCP Tools

```typescript
// Add new RAG optimization tools
export function ragTools(): ToolDef[] {
  return [
    {
      name: 'rag_search',
      description: 'Enhanced RAG search with hybrid scoring and query transformation.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          topK: { type: 'number', default: 10 },
          useHybrid: { type: 'boolean', default: true },
          useHyde: { type: 'boolean', default: false },
          filter: { type: 'object' },
        },
        required: ['query'],
      },
    },
    {
      name: 'rag_evaluate',
      description: 'Evaluate RAG performance metrics.',
      inputSchema: {
        type: 'object',
        properties: {
          testQueries: { type: 'array' },
        },
        required: ['testQueries'],
      },
    },
    {
      name: 'rag_cache_stats',
      description: 'Get RAG cache statistics.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ];
}
```

## Monitoring & Observability

### Metrics to Track

```typescript
interface RAGMetrics {
  // Query metrics
  queriesPerMinute: number;
  averageLatency: number;
  p95Latency: number;
  p99Latency: number;
  
  // Cache metrics
  cacheHitRate: number;
  cacheSize: number;
  cacheEvictions: number;
  
  // Index metrics
  totalDocuments: number;
  totalChunks: number;
  indexSizeBytes: number;
  
  // Quality metrics
  averageScore: number;
  scoreDistribution: number[];
}
```

### Dashboard

- Real-time query latency graphs
- Cache hit rate trends
- Index growth over time
- Score distribution histograms

## Conclusion

This RAG optimization design provides:

1. **Hybrid Search**: Combines BM25 keyword matching with vector semantic search
2. **Query Transformation**: HyDE and multi-query for better retrieval
3. **Advanced Chunking**: Semantic and hierarchical approaches
4. **Smart Caching**: Multi-level caching for performance
5. **Evaluation Framework**: RAGAS-inspired metrics for quality tracking

The system maintains backward compatibility while providing significant improvements in retrieval accuracy and performance. The modular design allows for incremental adoption and easy experimentation with different strategies.
