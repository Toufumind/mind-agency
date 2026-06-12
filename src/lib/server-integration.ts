/**
 * server-integration.ts — Unified server that combines Next.js and WebSocket
 *
 * This eliminates the dual-process architecture by running both servers
 * in a single process with shared state.
 */

import { EventBus, setEventBus } from './event-bus';
import { startWsServer, stopWsServer, getWsServer } from './ws-server';
import { ipcStore } from './ipc';
import { createLogger } from './logger';

const logger = createLogger('server-integration');

export interface ServerConfig {
  wsPort?: number;
  enableWs?: boolean;
}

export class UnifiedServer {
  private bus: EventBus;
  private config: ServerConfig;
  private started = false;

  constructor(config: ServerConfig = {}) {
    this.config = {
      wsPort: config.wsPort || 3001,
      enableWs: config.enableWs !== false,
    };

    // Create shared EventBus
    this.bus = new EventBus();
    setEventBus(this.bus);
  }

  /**
   * Start the unified server
   */
  async start(): Promise<void> {
    if (this.started) {
      logger.warn('Server already started');
      return;
    }

    logger.info('Starting unified server...');

    // Store server info in IPC
    ipcStore.set('server:startup', Date.now());
    ipcStore.set('server:pid', process.pid);

    // Start WebSocket server if enabled
    if (this.config.enableWs) {
      try {
        await startWsServer(this.bus, this.config.wsPort);
        logger.info(`WebSocket server started on port ${this.config.wsPort}`);
      } catch (error) {
        logger.error('Failed to start WebSocket server', error);
        // Continue without WebSocket - Next.js can still work
      }
    }

    this.started = true;
    logger.info('Unified server started successfully');

    // Setup graceful shutdown
    this.setupShutdown();
  }

  /**
   * Stop the unified server
   */
  async stop(): Promise<void> {
    if (!this.started) return;

    logger.info('Stopping unified server...');

    // Stop WebSocket server
    await stopWsServer();

    // Clear IPC state
    ipcStore.delete('server:startup');
    ipcStore.delete('server:pid');

    this.started = false;
    logger.info('Unified server stopped');
  }

  /**
   * Get the EventBus instance
   */
  getBus(): EventBus {
    return this.bus;
  }

  /**
   * Get WebSocket server instance
   */
  getWsServer() {
    return getWsServer();
  }

  /**
   * Check if server is started
   */
  isStarted(): boolean {
    return this.started;
  }

  /**
   * Setup graceful shutdown
   */
  private setupShutdown(): void {
    const shutdown = async () => {
      logger.info('Shutdown signal received');
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('exit', () => {
      // Sync cleanup
      ipcStore.delete('server:startup');
      ipcStore.delete('server:pid');
    });
  }
}

// Singleton instance
let unifiedServer: UnifiedServer | null = null;

export function getUnifiedServer(): UnifiedServer | null {
  return unifiedServer;
}

export async function startUnifiedServer(config?: ServerConfig): Promise<UnifiedServer> {
  if (unifiedServer) {
    await unifiedServer.stop();
  }

  unifiedServer = new UnifiedServer(config);
  await unifiedServer.start();
  return unifiedServer;
}

export async function stopUnifiedServer(): Promise<void> {
  if (unifiedServer) {
    await unifiedServer.stop();
    unifiedServer = null;
  }
}
