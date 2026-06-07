/**
 * Force-directed DAG Layout Engine
 *
 * Lightweight physics simulation for positioning workflow nodes.
 * No external dependencies — pure math.
 *
 * Forces:
 *   - Repulsion: nodes push each other away
 *   - Attraction: edges pull connected nodes together
 *   - Gravity: all nodes pulled toward center
 *   - Damping: velocity decay to prevent infinite oscillation
 */

export interface ForceNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Fixed position (for triggered/dragged nodes) */
  fx?: number;
  fy?: number;
  /** Node metadata */
  data?: any;
  /** Group ID for inter-group repulsion */
  group?: string;
}

export interface ForceEdge {
  source: string;
  target: string;
  label?: string;
}

export interface ForceConfig {
  repulsion: number;
  attraction: number;
  gravity: number;
  damping: number;
  maxVelocity: number;
  linkDistance: number;
  centerX: number;
  centerY: number;
  /** Extra repulsion multiplier between different groups */
  interGroupRepulsion: number;
  /** Force pulling nodes toward their group's center */
  groupGravity: number;
}

const DEFAULT_CONFIG: ForceConfig = {
  repulsion: 1200,
  attraction: 0.04,
  gravity: 0.015,
  damping: 0.88,
  maxVelocity: 8,
  linkDistance: 160,
  centerX: 0,
  centerY: 0,
  interGroupRepulsion: 5,
  groupGravity: 0.03,
};

export class ForceSimulation {
  nodes: Map<string, ForceNode> = new Map();
  edges: ForceEdge[] = [];
  config: ForceConfig;
  running = false;
  private animFrame: number | null = null;
  private onTickCb: ((nodes: Map<string, ForceNode>) => void) | null = null;

  constructor(config?: Partial<ForceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Set nodes from workflow steps */
  setNodes(steps: { id: string; [key: string]: any }[]): void {
    const existing = new Map(this.nodes);
    this.nodes.clear();

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const old = existing.get(s.id);
      this.nodes.set(s.id, {
        id: s.id,
        x: old?.x ?? (Math.random() - 0.5) * 400 + this.config.centerX,
        y: old?.y ?? (i * 100) + this.config.centerY - (steps.length * 50),
        vx: old?.vx ?? 0,
        vy: old?.vy ?? 0,
        group: (s as any).group,
        data: s,
      });
    }
  }

  /** Set edges from workflow dependencies */
  setEdges(edges: ForceEdge[]): void {
    this.edges = edges;
  }

  /** Set callback for each tick */
  onTick(cb: (nodes: Map<string, ForceNode>) => void): void {
    this.onTickCb = cb;
  }

  /** Start simulation */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  /** Stop simulation */
  stop(): void {
    this.running = false;
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
  }

  /** Single tick — apply forces and update positions */
  private tick(): void {
    if (!this.running) return;

    const { repulsion, attraction, gravity, damping, maxVelocity, linkDistance, centerX, centerY, interGroupRepulsion, groupGravity } = this.config;
    const nodeArr = [...this.nodes.values()];

    // Reset forces
    for (const n of nodeArr) {
      if (n.fx !== undefined) { n.x = n.fx; n.y = n.fy!; n.vx = 0; n.vy = 0; continue; }
      n.vx = 0;
      n.vy = 0;
    }

    // 1. Repulsion — all pairs (stronger between different groups)
    for (let i = 0; i < nodeArr.length; i++) {
      for (let j = i + 1; j < nodeArr.length; j++) {
        const a = nodeArr[i], b = nodeArr[j];
        if (a.fx !== undefined && b.fx !== undefined) continue;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; dist = 1; }
        // Inter-group repulsion: much stronger between different workflows
        const sameGroup = a.group && b.group && a.group === b.group;
        const forceMultiplier = sameGroup ? 1 : interGroupRepulsion;
        const force = (repulsion * forceMultiplier) / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (a.fx === undefined) { a.vx += fx; a.vy += fy; }
        if (b.fx === undefined) { b.vx -= fx; b.vy -= fy; }
      }
    }

    // 2. Attraction — edges
    for (const e of this.edges) {
      const a = this.nodes.get(e.source);
      const b = this.nodes.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const force = (dist - linkDistance) * attraction;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (a.fx === undefined) { a.vx += fx; a.vy += fy; }
      if (b.fx === undefined) { b.vx -= fx; b.vy -= fy; }
    }

    // 3. Gravity — toward global center
    for (const n of nodeArr) {
      if (n.fx !== undefined) continue;
      n.vx += (centerX - n.x) * gravity;
      n.vy += (centerY - n.y) * gravity;
    }

    // 4. Group gravity — pull each node toward its group's center of mass
    const groupCenters = new Map<string, { x: number; y: number; count: number }>();
    for (const n of nodeArr) {
      if (!n.group) continue;
      const existing = groupCenters.get(n.group) || { x: 0, y: 0, count: 0 };
      existing.x += n.x; existing.y += n.y; existing.count++;
      groupCenters.set(n.group, existing);
    }
    for (const [, c] of groupCenters) { c.x /= c.count; c.y /= c.count; }

    for (const n of nodeArr) {
      if (n.fx !== undefined || !n.group) continue;
      const center = groupCenters.get(n.group);
      if (!center) continue;
      n.vx += (center.x - n.x) * groupGravity;
      n.vy += (center.y - n.y) * groupGravity;
    }

    // 4. Apply velocity with damping
    for (const n of nodeArr) {
      if (n.fx !== undefined) continue;
      n.vx *= damping;
      n.vy *= damping;
      // Clamp velocity
      const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
      if (speed > maxVelocity) {
        n.vx = (n.vx / speed) * maxVelocity;
        n.vy = (n.vy / speed) * maxVelocity;
      }
      n.x += n.vx;
      n.y += n.vy;
    }

    // Callback
    if (this.onTickCb) this.onTickCb(this.nodes);

    // Continue
    this.animFrame = requestAnimationFrame(() => this.tick());
  }

  /** Get bounds of all nodes */
  getBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of this.nodes.values()) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x);
      maxY = Math.max(maxY, n.y);
    }
    return { minX: minX - 80, minY: minY - 40, maxX: maxX + 80, maxY: maxY + 40 };
  }

  /** Pin a node to a position */
  pin(id: string, x: number, y: number): void {
    const n = this.nodes.get(id);
    if (n) { n.fx = x; n.fy = y; }
  }

  /** Unpin a node */
  unpin(id: string): void {
    const n = this.nodes.get(id);
    if (n) { n.fx = undefined; n.fy = undefined; }
  }
}
