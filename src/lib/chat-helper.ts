/**
 * Shared chat message writer — single source of truth for all chat writes.
 * Replaces appendFileSync with per-message atomic files.
 */

import { writeChatMessage } from './atomic';
export { writeChatMessage };
