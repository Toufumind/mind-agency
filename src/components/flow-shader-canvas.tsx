'use client';
import { useEffect, useRef } from 'react';

// ── All visual rendering in one WebGL shader ──

interface RenderNode {
  x: number; y: number;
  status: number; // 0=pending, 1=waiting, 2=running, 3=done, 4=failed, 5=trigger
  isHovered: number;
}

interface RenderEdge {
  x1: number; y1: number; x2: number; y2: number;
  active: number;
}

interface RenderCell {
  nodes: { x: number; y: number }[];
  colorIdx: number;
}

interface FlowShaderCanvasProps {
  width: number; height: number;
  zoom: number; pan: { x: number; y: number };
  cells: RenderCell[];
  nodes: RenderNode[];
  edges: RenderEdge[];
  time: number;
}

const VERT = `attribute vec2 a_pos; void main(){ gl_Position=vec4(a_pos,0,1); }`;

const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time, u_zoom;
uniform vec2 u_pan;

// Cell data
const int MC=16, MN=32;
uniform int u_cellN;
uniform vec2 u_cellNodes[MC*MN];
uniform int u_cellCounts[MC];
uniform vec3 u_cellColors[MC];

// Node data
uniform int u_nodeN;
uniform vec2 u_nodePos[256];
uniform float u_nodeStatus[256]; // 0-5
uniform float u_nodeHover[256];

// Edge data
uniform int u_edgeN;
uniform vec4 u_edgeData[256]; // x1,y1,x2,y2
uniform float u_edgeActive[256];

// Colors — dark theme
const vec3 BG=vec3(0.035,0.039,0.055);
const vec3 COL[6]=vec3[6](
  vec3(0.388,0.400,0.945), // indigo
  vec3(0.545,0.361,0.965), // violet
  vec3(0.925,0.282,0.600), // pink
  vec3(0.961,0.620,0.043), // amber
  vec3(0.063,0.725,0.502), // green
  vec3(0.231,0.510,0.965)  // blue
);
const vec3 S_COL[6]=vec3[6](
  vec3(0.267,0.275,0.396), // pending
  vec3(0.918,0.702,0.031), // waiting yellow
  vec3(0.231,0.510,0.965), // running blue
  vec3(0.133,0.773,0.369), // done green
  vec3(0.937,0.267,0.267), // failed red
  vec3(0.655,0.545,0.980)  // trigger violet
);

vec2 toWorld(vec2 uv){ return (vec2(uv.x, u_res.y-uv.y)-u_pan)/u_zoom; }

float metaball(vec2 p, vec2 c, float r){ return r*r/dot(p-c,p-c+0.001); }

float sdCircle(vec2 p, vec2 c, float r){ return length(p-c)-r; }

void main(){
  vec2 uv=gl_FragCoord.xy;
  vec2 wp=toWorld(uv);
  vec3 col=BG;
  float alpha=1.0;

  // ════════ CELLS (metaball) ════════
  for(int c=0;c<MC;c++){
    if(c>=u_cellN) break;
    float field=0.0;
    int cnt=u_cellCounts[c];
    for(int n=0;n<MN;n++){
      if(n>=cnt) break;
      field+=metaball(wp, u_cellNodes[c*MN+n], 160.0);
    }
    float pulse=0.85+0.15*sin(u_time*0.7+float(c)*2.1);
    float cyto=smoothstep(0.25,0.7,field)*0.35;
    float wallI=smoothstep(0.5,0.9,field);
    float wallO=smoothstep(0.9,1.4,field);
    float wall=(wallI-wallO)*pulse;
    float glow=smoothstep(2.5,0.3,wallO)*0.5;
    float inner=smoothstep(0.0,0.4,field)*0.12;
    vec3 cc=COL[c];
    col+=cc*cyto*0.35 + cc*wall*2.0 + cc*glow + cc*inner;
    alpha=max(alpha, max(cyto*0.4, max(wall, glow*0.7)));
  }

  // ════════ EDGES (flowing water) ════════
  for(int e=0;e<256;e++){
    if(e>=u_edgeN) break;
    vec4 ed=u_edgeData[e];
    vec2 a=vec2(ed.x,ed.y), b=vec2(ed.z,ed.w);
    float act=u_edgeActive[e];

    // Distance to curve (approximate with line distance)
    vec2 ba=b-a;
    float t=clamp(dot(wp-a,ba)/dot(ba,ba),0.0,1.0);
    vec2 proj=a+t*ba;
    float dist=length(wp-proj);

    // Flowing line
    float lineW=act>0.5 ? 2.5 : 1.0;
    float line=1.0-smoothstep(0.0,lineW+1.0,dist);

    // Flowing dash animation
    float flowPhase=t*20.0-u_time*3.0;
    float dash=act>0.5 ? 0.5+0.5*sin(flowPhase) : 0.3;

    // Color
    vec3 lineCol=act>0.5 ? vec3(0.376,0.647,0.965) : vec3(0.2,0.22,0.27);
    float lineAlpha=line*dash*(act>0.5?0.9:0.4);

    // Glow around active edges
    float edgeGlow=act>0.5 ? (1.0-smoothstep(0.0,12.0,dist))*0.15 : 0.0;

    col+=lineCol*lineAlpha + lineCol*edgeGlow;
    alpha=max(alpha, lineAlpha+edgeGlow);

    // Flowing particles
    if(act>0.5){
      for(int p=0;p<3;p++){
        float pt=fract(u_time*0.15+float(p)*0.33);
        vec2 particlePos=a+ba*pt;
        float pDist=length(wp-particlePos);
        float particle=(1.0-smoothstep(0.0,4.0,pDist))*(1.0-pt*0.7);
        col+=vec3(0.478,0.671,0.980)*particle*0.8;
        alpha=max(alpha,particle*0.8);
      }
    }
  }

  // ════════ NODES (circles with glow) ════════
  for(int i=0;i<256;i++){
    if(i>=u_nodeN) break;
    vec2 np=u_nodePos[i];
    float st=u_nodeStatus[i];
    float hv=u_nodeHover[i];

    float d=length(wp-np);

    // Main circle
    float circle=1.0-smoothstep(25.0,28.0,d);

    // Glow
    float glowR=st>1.5 && st<2.5 ? 50.0 : 40.0;
    float nodeGlow=(1.0-smoothstep(0.0,glowR,d))*0.3;

    // Pulse for running
    float pulse=1.0;
    if(st>1.5 && st<2.5){
      pulse=0.7+0.3*sin(u_time*3.0+float(i)*0.5);
      // Outer ring
      float ring=abs(d-30.0);
      float ringAlpha=(1.0-smoothstep(0.0,2.0,ring))*0.4*pulse;
      col+=S_COL[2]*ringAlpha;
    }

    // Hover highlight
    float hoverCircle=1.0-smoothstep(26.0,30.0,d)*hv;

    // Node color
    int si=int(st);
    vec3 nodeCol=S_COL[si];

    // Fill
    vec3 fillCol=vec3(0.059,0.090,0.165); // dark fill
    col+=fillCol*circle;
    col+=nodeCol*circle*0.3; // tinted fill
    col+=nodeCol*(nodeGlow+hoverCircle*0.4)*pulse;
    alpha=max(alpha,max(circle*0.95,nodeGlow*0.5));

    // Status icon (simplified — colored dot)
    if(st>2.5 && st<3.5){
      // Done: green check
      float checkD=abs(wp.x-np.x)+abs(wp.y-np.y-2.0);
      float check=1.0-smoothstep(3.0,4.0,checkD);
      col+=vec3(0.133,0.773,0.369)*check;
    }
    if(st>3.5 && st<4.5){
      // Failed: red X
      float xd=abs(wp.x-np.x)-abs(wp.y-np.y);
      float xmark=1.0-smoothstep(2.0,3.0,abs(xd));
      float xmark2=1.0-smoothstep(2.0,3.0,abs(wp.x-np.x+wp.y-np.y));
      col+=vec3(0.937,0.267,0.267)*max(xmark,xmark2)*0.8;
    }
  }

  // ════════ GRID ════════
  vec2 grid=fract(wp/40.0);
  float gridLine=max(
    1.0-smoothstep(0.0,0.02,grid.x)*smoothstep(0.0,0.02,1.0-grid.x),
    1.0-smoothstep(0.0,0.02,grid.y)*smoothstep(0.0,0.02,1.0-grid.y)
  );
  col+=vec3(0.12,0.14,0.18)*gridLine*0.15;

  gl_FragColor=vec4(col,alpha);
}`;

// ── WebGL helpers ──

function createShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); gl.deleteShader(s); return null; }
  return s;
}

function createProgram(gl: WebGLRenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram | null {
  const p = gl.createProgram()!;
  gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(p)); gl.deleteProgram(p); return null; }
  return p;
}

// ── Component ──

export default function FlowShaderCanvas({ width, height, zoom, pan, cells, nodes, edges, time }: FlowShaderCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const progRef = useRef<WebGLProgram | null>(null);
  const bufRef = useRef<WebGLBuffer | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true });
      if (!gl) return;
      glRef.current = gl;

      const vs = createShader(gl, gl.VERTEX_SHADER, VERT);
      const fs = createShader(gl, gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return;
      const prog = createProgram(gl, vs, fs);
      if (!prog) return;
      progRef.current = prog;

      const buf = gl.createBuffer();
      if (!buf) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      bufRef.current = buf;

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      return () => { gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteBuffer(buf); };
    } catch (e) { console.error('WebGL init error:', e); }
  }, []);

  useEffect(() => {
    const gl = glRef.current, prog = progRef.current, buf = bufRef.current;
    if (!gl || !prog || !buf) return;

    try {
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);

      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const pos = gl.getAttribLocation(prog, 'a_pos');
      if (pos >= 0) {
        gl.enableVertexAttribArray(pos);
        gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
      }

      // Helper: set uniform only if location exists
      const set2f = (n: string, x: number, y: number) => { const l = gl.getUniformLocation(prog, n); if (l) gl.uniform2f(l, x, y); };
      const set1f = (n: string, x: number) => { const l = gl.getUniformLocation(prog, n); if (l) gl.uniform1f(l, x); };
      const set1i = (n: string, x: number) => { const l = gl.getUniformLocation(prog, n); if (l) gl.uniform1i(l, x); };
      const set2fv = (n: string, v: Float32Array) => { const l = gl.getUniformLocation(prog, n); if (l) gl.uniform2fv(l, v); };
      const set1fv = (n: string, v: Float32Array) => { const l = gl.getUniformLocation(prog, n); if (l) gl.uniform1fv(l, v); };
      const set3f = (n: string, x: number, y: number, z: number) => { const l = gl.getUniformLocation(prog, n); if (l) gl.uniform3f(l, x, y, z); };

      set2f('u_res', width, height);
      set1f('u_time', time * 0.016);
      set1f('u_zoom', zoom);
      set2f('u_pan', pan.x, pan.y);

      // Cells
      set1i('u_cellN', Math.min(cells.length, 16));
      const cellData: number[] = [];
      const cellCounts: number[] = [];
      const cellColors: number[] = [];
      const CC = [[0.388,0.400,0.945],[0.545,0.361,0.965],[0.925,0.282,0.600],[0.961,0.620,0.043],[0.063,0.725,0.502],[0.231,0.510,0.965]];
      for (let c = 0; c < Math.min(cells.length, 16); c++) {
        const cell = cells[c];
        cellCounts.push(Math.min(cell.nodes.length, 32));
        const ci = CC[cell.colorIdx % CC.length];
        cellColors.push(ci[0], ci[1], ci[2]);
        for (let n = 0; n < 32; n++) {
          if (n < cell.nodes.length) { cellData.push(cell.nodes[n].x, cell.nodes[n].y); }
          else { cellData.push(0, 0); }
        }
      }
      set2fv('u_cellNodes[0]', new Float32Array(cellData));
      for (let i = 0; i < 16; i++) { set1i(`u_cellCounts[${i}]`, cellCounts[i] || 0); }
      for (let i = 0; i < 16; i++) { const ci = i * 3; set3f(`u_cellColors[${i}]`, cellColors[ci] || 0, cellColors[ci + 1] || 0, cellColors[ci + 2] || 0); }

    // Nodes
    set1i('u_nodeN', Math.min(nodes.length, 256));
    const nodePos: number[] = [];
    const nodeStatus: number[] = [];
    const nodeHover: number[] = [];
    for (let i = 0; i < Math.min(nodes.length, 256); i++) {
      nodePos.push(nodes[i].x, nodes[i].y);
      nodeStatus.push(nodes[i].status);
      nodeHover.push(nodes[i].isHovered);
    }
    set2fv('u_nodePos[0]', new Float32Array(nodePos));
    set1fv('u_nodeStatus[0]', new Float32Array(nodeStatus));
    set1fv('u_nodeHover[0]', new Float32Array(nodeHover));

    // Edges
    set1i('u_edgeN', Math.min(edges.length, 256));
    const edgeData: number[] = [];
    const edgeActive: number[] = [];
    for (let i = 0; i < Math.min(edges.length, 256); i++) {
      edgeData.push(edges[i].x1, edges[i].y1, edges[i].x2, edges[i].y2);
      edgeActive.push(edges[i].active);
    }
    const set4fv = (n: string, v: Float32Array) => { const l = gl.getUniformLocation(prog, n); if (l) gl.uniform4fv(l, v); };
    set4fv('u_edgeData[0]', new Float32Array(edgeData));
    set1fv('u_edgeActive[0]', new Float32Array(edgeActive));

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    } catch (e) { console.error('WebGL render error:', e); }
  }, [width, height, zoom, pan, cells, nodes, edges, time]);

  return <canvas ref={canvasRef} width={width} height={height} className="absolute inset-0" style={{ zIndex: 0 }} />;
}
