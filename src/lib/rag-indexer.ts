/**
 * rag-indexer.ts — Background RAG indexing with job queue
 *
 * Moves RAG indexing out of the request path into background processing.
 */

import { EventEmitter } from 'events';
import { createLogger } from './logger';

const logger = createLogger('rag-indexer');

export interface IndexJob {
  id: string;
  agent: string;
  group?: string;
  type: 'full' | 'memory' | 'skills' | 'knowledge' | 'group_knowledge' | 'session';
  data?: any;
  priority: 'high' | 'normal' | 'low';
  createdAt: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}

class RAGIndexer extends EventEmitter {
  private queue: IndexJob[] = [];
  private processing = false;
  private maxConcurrent = 2;
  private activeJobs = 0;
  private jobCounter = 0;

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /**
   * Add a job to the queue
   */
  enqueue(agent: string, type: IndexJob['type'], options: {
    group?: string;
    data?: any;
    priority?: IndexJob['priority'];
  } = {}): string {
    const job: IndexJob = {
      id: `job-${++this.jobCounter}-${Date.now()}`,
      agent,
      group: options.group,
      type,
      data: options.data,
      priority: options.priority || 'normal',
      createdAt: Date.now(),
      status: 'pending',
    };

    // Insert based on priority
    if (job.priority === 'high') {
      this.queue.unshift(job);
    } else {
      this.queue.push(job);
    }

    logger.debug(`Enqueued job ${job.id} for agent ${agent}`, { type, priority: job.priority });

    // Start processing if not already running
    this.processNext();

    return job.id;
  }

  /**
   * Process the next job in the queue
   */
  private async processNext(): Promise<void> {
    if (this.processing || this.activeJobs >= this.maxConcurrent) return;
    if (this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0 && this.activeJobs < this.maxConcurrent) {
      const job = this.queue.shift();
      if (!job) break;

      this.activeJobs++;
      this.processJob(job).finally(() => {
        this.activeJobs--;
        this.processNext();
      });
    }

    this.processing = false;
  }

  /**
   * Process a single job
   */
  private async processJob(job: IndexJob): Promise<void> {
    job.status = 'processing';
    logger.info(`Processing job ${job.id}`, { agent: job.agent, type: job.type });

    try {
      const { indexAll, indexAgentMemory, indexAgentSkills, indexAgentKnowledge, indexGroupKnowledge, indexSessionContext } = await import('./rag');

      switch (job.type) {
        case 'full':
          await indexAll(job.agent, job.group);
          break;
        case 'memory':
          await indexAgentMemory(job.agent);
          break;
        case 'skills':
          await indexAgentSkills(job.agent);
          break;
        case 'knowledge':
          await indexAgentKnowledge(job.agent);
          break;
        case 'group_knowledge':
          if (job.group) await indexGroupKnowledge(job.group);
          break;
        case 'session':
          if (job.data?.messages) await indexSessionContext(job.agent, job.data.messages);
          break;
      }

      job.status = 'completed';
      logger.info(`Completed job ${job.id}`, { agent: job.agent, type: job.type });
      this.emit('completed', job);
    } catch (error: any) {
      job.status = 'failed';
      job.error = error.message;
      logger.error(`Failed job ${job.id}`, error);
      this.emit('failed', job);
    }
  }

  /**
   * Get queue status
   */
  getStatus(): {
    queueLength: number;
    activeJobs: number;
    processing: boolean;
  } {
    return {
      queueLength: this.queue.length,
      activeJobs: this.activeJobs,
      processing: this.processing,
    };
  }

  /**
   * Get job by ID
   */
  getJob(id: string): IndexJob | undefined {
    return this.queue.find(j => j.id === id);
  }

  /**
   * Clear completed jobs from memory
   */
  cleanup(): void {
    // Keep only pending and processing jobs
    this.queue = this.queue.filter(j => j.status === 'pending' || j.status === 'processing');
  }
}

// Singleton instance
export const ragIndexer = new RAGIndexer();

/**
 * Helper: Schedule full index for an agent
 */
export function scheduleFullIndex(agent: string, group?: string): string {
  return ragIndexer.enqueue(agent, 'full', { group, priority: 'normal' });
}

/**
 * Helper: Schedule incremental session index
 */
export function scheduleSessionIndex(agent: string, messages: Array<{ role: string; content: string }>): string {
  return ragIndexer.enqueue(agent, 'session', { data: { messages }, priority: 'low' });
}
