'use client';
import { useEffect, useRef, useMemo } from 'react';

// ── Types ──

interface CellData {
  nodes: { x: number; y: number }[];
  color: [number, number, number]; // RGB 0-1
}

interface FlowCellsWebGLProps {
  cells: CellData[];
  zoom: number;
  pan: { x: number; y: number };
  width: number;
  height: number;
  time: number;
}

// ── Colors (hex → RGB 0-1) ──
const CELL_COLORS: [number, number, number][] = [
  [0.388, 0.400, 0.945],  // indigo
  [0.545, 0.361, 0.965],  // violet
  [0.925, 0.282, 0.600],  // pink
  [0.961, 0.620, 0.043],  // amber
  [0.063, 0.725, 0.502],  // green
  [0.231, 0.510, 0.965],  // blue
];

// ── GLSL Shaders ──

const VERT_SRC = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const FRAG_SRC = `
  precision highp float;

  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_zoom;
  uniform vec2 u_pan;
  uniform int u_cellCount;

  // Per-cell data (max 16 workflows)
  const int MAX_CELLS = 16;
  const int MAX_NODES_PER_CELL = 32;
  uniform vec2 u_cellNodes[MAX_CELLS * MAX_NODES_PER_CELL];
  uniform int u_cellNodeCounts[MAX_CELLS];
  uniform vec3 u_cellColors[MAX_CELLS];

  // Metaball field function
  float field(vec2 uv, vec2 pos, float radius) {
    vec2 d = uv - pos;
    return (radius * radius) / dot(d, d);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy;
    vec4 finalColor = vec4(0.0);

    for (int c = 0; c < MAX_CELLS; c++) {
      if (c >= u_cellCount) break;

      float totalField = 0.0;
      vec3 cellColor = u_cellColors[c];
      int nodeCount = u_cellNodeCounts[c];

      // Accumulate field from all nodes in this cell
      for (int n = 0; n < MAX_NODES_PER_CELL; n++) {
        if (n >= nodeCount) break;
        int idx = c * MAX_NODES_PER_CELL + n;
        vec2 nodePos = u_cellNodes[idx];
        // Transform: screen → world → UV
        vec2 worldPos = (uv - u_pan) / u_zoom;
        totalField += field(worldPos, nodePos, 120.0);
      }

      // Thresholds for cytoplasm and cell wall
      float cytoplasm = smoothstep(0.8, 1.2, totalField);
      float wallInner = smoothstep(1.0, 1.4, totalField);
      float wallOuter = smoothstep(1.4, 1.8, totalField);
      float wall = wallInner - wallOuter;

      // Pulsing effect for cell wall
      float pulse = 0.85 + 0.15 * sin(u_time * 0.5 + float(c) * 1.7);
      wall *= pulse;

      // Cytoplasm: subtle gradient from center
      float centerDist = 0.0;
      for (int n = 0; n < MAX_NODES_PER_CELL; n++) {
        if (n >= nodeCount) break;
        int idx = c * MAX_NODES_PER_CELL + n;
        vec2 nodePos = u_cellNodes[idx];
        vec2 worldPos = (uv - u_pan) / u_zoom;
        centerDist += length(worldPos - nodePos);
      }
      centerDist /= float(nodeCount);
      float gradient = 1.0 - smoothstep(0.0, 300.0, centerDist);

      // Compose cell
      vec3 cytoColor = cellColor * 0.08 * gradient * cytoplasm;
      vec3 wallColor = cellColor * 0.7 * wall;

      // Add glow around wall
      float glow = smoothstep(2.5, 1.0, wallOuter) * 0.15;
      vec3 glowColor = cellColor * glow;

      vec3 cellResult = cytoColor + wallColor + glowColor;
      float alpha = max(max(cytoplasm * 0.25, wall * 0.8), glow * 0.5);

      // Additive blending for overlapping cells (but they shouldn't overlap much)
      finalColor.rgb += cellResult * alpha;
      finalColor.a = max(finalColor.a, alpha);
    }

    // Clamp
    finalColor.rgb = min(finalColor.rgb, vec3(1.0));
    gl_FragColor = finalColor;
  }
`;

// ── WebGL Helpers ──

function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext, vert: WebGLShader, frag: WebGLShader): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

// ── Component ──

export default function FlowCellsWebGL({ cells, zoom, pan, width, height, time }: FlowCellsWebGLProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const uniformsRef = useRef<Record<string, WebGLUniformLocation | null>>({});
  const bufferRef = useRef<WebGLBuffer | null>(null);

  // ── Initialize WebGL ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    if (!gl) { console.error('WebGL not supported'); return; }
    glRef.current = gl;

    // Create shaders
    const vert = createShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const frag = createShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vert || !frag) return;

    const program = createProgram(gl, vert, frag);
    if (!program) return;
    programRef.current = program;

    // Get uniform locations
    const uNames = [
      'u_resolution', 'u_time', 'u_zoom', 'u_pan', 'u_cellCount',
      ...Array.from({ length: 16 }, (_, i) => `u_cellNodeCounts[${i}]`),
      ...Array.from({ length: 16 }, (_, i) => `u_cellColors[${i}]`),
    ];
    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of uNames) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    uniformsRef.current = uniforms;

    // Full-screen quad
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ]), gl.STATIC_DRAW);
    bufferRef.current = buffer;

    // Enable blending
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    return () => {
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      gl.deleteBuffer(buffer);
    };
  }, []);

  // ── Render ──
  useEffect(() => {
    const gl = glRef.current;
    const program = programRef.current;
    const u = uniformsRef.current;
    const buffer = bufferRef.current;
    if (!gl || !program || !buffer) return;

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);

    // Bind quad
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Set uniforms
    gl.uniform2f(u.u_resolution, width, height);
    gl.uniform1f(u.u_time, time * 0.016); // Convert frame count to seconds-ish
    gl.uniform1f(u.u_zoom, zoom);
    gl.uniform2f(u.u_pan, pan.x, pan.y);
    gl.uniform1i(u.u_cellCount, Math.min(cells.length, 16));

    // Pack cell data into flat arrays
    const nodeCounts: number[] = [];
    const colors: number[] = [];
    const nodeData: number[] = [];
    const MAX_NODES = 32;
    const MAX_CELLS = 16;

    for (let c = 0; c < Math.min(cells.length, MAX_CELLS); c++) {
      const cell = cells[c];
      nodeCounts.push(Math.min(cell.nodes.length, MAX_NODES));
      colors.push(cell.color[0], cell.color[1], cell.color[2]);

      for (let n = 0; n < MAX_NODES; n++) {
        if (n < cell.nodes.length) {
          nodeData.push(cell.nodes[n].x, cell.nodes[n].y);
        } else {
          nodeData.push(0, 0);
        }
      }
    }

    // Set node counts
    for (let i = 0; i < MAX_CELLS; i++) {
      const loc = gl.getUniformLocation(program, `u_cellNodeCounts[${i}]`);
      if (loc) gl.uniform1i(loc, nodeCounts[i] || 0);
    }

    // Set colors
    for (let i = 0; i < MAX_CELLS; i++) {
      const loc = gl.getUniformLocation(program, `u_cellColors[${i}]`);
      if (loc) gl.uniform3f(loc, colors[i * 3] || 0, colors[i * 3 + 1] || 0, colors[i * 3 + 2] || 0);
    }

    // Pack node positions into uniform array
    // WebGL uniform arrays need to be set as flat floats
    const nodeFloats = new Float32Array(MAX_CELLS * MAX_NODES * 2);
    for (let i = 0; i < nodeData.length && i < nodeFloats.length; i++) {
      nodeFloats[i] = nodeData[i];
    }
    const nodeLoc = gl.getUniformLocation(program, 'u_cellNodes[0]');
    if (nodeLoc) gl.uniform2fv(nodeLoc, nodeFloats);

    // Draw
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }, [cells, zoom, pan, width, height, time]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}

export { CELL_COLORS };
