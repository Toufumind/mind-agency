'use client';
import { useEffect, useRef, useCallback } from 'react';

// ══════════════════════════════════════════════════════════════
//  Flow GPU — 全 shader 渲染引擎
//  所有视觉效果（细胞、箭头、节点、网格、文字）全部由 GPU 渲染
// ══════════════════════════════════════════════════════════════

interface GPUProps {
  width: number; height: number;
  zoom: number; pan: { x: number; y: number };
  theme: string; // theme ID
  // Cell data: array of workflows, each with node positions + color index
  cellNodes: number[][]; // cellNodes[i] = [x1,y1,x2,y2,...]
  cellColors: number[][]; // cellColors[i] = [r,g,b]
  cellLabels: { text: string; x: number; y: number; color: number[] }[];
  // Node data
  nodeX: number[]; nodeY: number[];
  nodeStatus: number[]; // 0=pending 1=wait 2=running 3=done 4=fail 5=trigger
  nodeHover: number[]; // 0 or 1
  nodeLabels: { text: string; x: number; y: number }[];
  // Edge data
  edgeX1: number[]; edgeY1: number[];
  edgeX2: number[]; edgeY2: number[];
  edgeActive: number[];
  // Animation
  time: number;
}

// ── Theme-aware colors ──
// Each theme defines: bg, grid, nodeFill, edgeIdle, edgeActive
interface ThemeColors {
  bg: number[]; grid: number[]; nodeFill: number[];
  edgeIdle: number[]; edgeActive: number[];
  cellIntensity: number; // 0-1, higher = more visible cells on light themes
}

const THEMES: Record<string, ThemeColors> = {
  'deep-space':    { bg: [0.051,0.051,0.071], grid: [0.09,0.09,0.11], nodeFill: [0.059,0.09,0.165], edgeIdle: [0.2,0.22,0.27], edgeActive: [0.298,0.435,0.961], cellIntensity: 0.15 },
  'nord':          { bg: [0.106,0.118,0.145], grid: [0.14,0.16,0.19], nodeFill: [0.129,0.141,0.173], edgeIdle: [0.23,0.25,0.32], edgeActive: [0.38,0.55,0.78], cellIntensity: 0.18 },
  'tokyo-night':   { bg: [0.078,0.090,0.118], grid: [0.11,0.12,0.16], nodeFill: [0.090,0.102,0.133], edgeIdle: [0.20,0.22,0.28], edgeActive: [0.42,0.60,0.92], cellIntensity: 0.16 },
  'dracula':       { bg: [0.114,0.106,0.141], grid: [0.15,0.14,0.18], nodeFill: [0.125,0.118,0.157], edgeIdle: [0.25,0.23,0.30], edgeActive: [0.80,0.55,0.98], cellIntensity: 0.17 },
  'notion':        { bg: [0.961,0.957,0.949], grid: [0.90,0.89,0.88], nodeFill: [0.933,0.929,0.922], edgeIdle: [0.75,0.74,0.73], edgeActive: [0.298,0.435,0.961], cellIntensity: 0.08 },
  'minimal-white': { bg: [0.980,0.976,0.973], grid: [0.93,0.92,0.91], nodeFill: [0.957,0.953,0.949], edgeIdle: [0.78,0.77,0.76], edgeActive: [0.298,0.435,0.961], cellIntensity: 0.06 },
  'warm-wood':     { bg: [0.953,0.925,0.878], grid: [0.88,0.84,0.78], nodeFill: [0.922,0.890,0.835], edgeIdle: [0.72,0.66,0.58], edgeActive: [0.65,0.45,0.25], cellIntensity: 0.10 },
  'solarized-light': { bg: [0.965,0.957,0.910], grid: [0.90,0.89,0.84], nodeFill: [0.941,0.933,0.886], edgeIdle: [0.70,0.69,0.64], edgeActive: [0.16,0.50,0.55], cellIntensity: 0.07 },
};

function hexToRgb01(hex: string): number[] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

const CELL_PALETTE = [
  [0.388, 0.400, 0.945], // indigo
  [0.545, 0.361, 0.965], // violet
  [0.925, 0.282, 0.600], // pink
  [0.961, 0.620, 0.043], // amber
  [0.063, 0.725, 0.502], // green
  [0.231, 0.510, 0.965], // blue
];

const MAX_CELLS = 8;
const MAX_NODES = 128;
const MAX_EDGES = 128;

// ── GLSL Vertex ──
const VERT = `attribute vec2 a_pos; void main(){gl_Position=vec4(a_pos,0,1);}`;

// ── GLSL Fragment — 全部视觉效果 ──
const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time, u_zoom;
uniform vec2 u_pan;

// Theme colors
uniform vec3 u_bg;
uniform vec3 u_grid;
uniform vec3 u_nodeFill;
uniform vec3 u_edgeIdle;
uniform vec3 u_edgeActive;
uniform float u_cellIntensity;

// Cells
uniform int u_cellN;
uniform vec2 u_cellNodes[${MAX_CELLS * 32}];
uniform int u_cellCounts[${MAX_CELLS}];
uniform vec3 u_cellColors[${MAX_CELLS}];

// Nodes
uniform int u_nodeN;
uniform vec2 u_nodePos[${MAX_NODES}];
uniform float u_nodeSt[${MAX_NODES}];
uniform float u_nodeHv[${MAX_NODES}];

// Edges
uniform int u_edgeN;
uniform vec4 u_edgeD[${MAX_EDGES}];
uniform float u_edgeA[${MAX_EDGES}];

vec2 s2w(vec2 sp){return(sp-u_pan)/u_zoom;}
float metaball(vec2 p,vec2 c,float r){return r*r/dot(p-c,p-c+.001);}

void main(){
  vec2 sp=gl_FragCoord.xy;
  sp.y=u_res.y-sp.y;
  vec2 wp=s2w(sp);
  vec3 col=u_bg;
  float alpha=1.0;

  // ══════════ GRID ══════════
  vec2 g=fract(wp/50.0);
  float gl_=step(0.97,g.x)+step(0.97,g.y);
  col+=u_grid*gl_*0.3;

  // ══════════ CELLS ══════════
  for(int c=0;c<${MAX_CELLS};c++){
    if(c>=u_cellN) break;
    float field=0.0;
    int cnt=u_cellCounts[c];
    for(int n=0;n<32;n++){
      if(n>=cnt) break;
      field+=metaball(wp,u_cellNodes[c*32+n],180.0);
    }
    float pulse=.82+.18*sin(u_time*.7+float(c)*2.3);
    float cy=smoothstep(.2,.6,field)*u_cellIntensity;
    float wI=smoothstep(.45,.8,field);
    float wO=smoothstep(.8,1.3,field);
    float w=(wI-wO)*pulse;
    float gw=smoothstep(2.2,.2,wO)*.45;
    float ig=smoothstep(0.,.35,field)*.1;
    vec3 cc=u_cellColors[c];
    col+=cc*cy*.4+cc*w*2.2+cc*gw+cc*ig;
  }

  // ══════════ EDGES ══════════
  for(int e=0;e<${MAX_EDGES};e++){
    if(e>=u_edgeN) break;
    vec4 ed=u_edgeD[e];
    vec2 a=vec2(ed.x,ed.y),b=vec2(ed.z,ed.w);
    float act=u_edgeA[e];
    vec2 ba=b-a;
    float t=clamp(dot(wp-a,ba)/dot(ba,ba),0.,1.);
    float dist=length(wp-(a+t*ba));
    float lw=act>.5?2.5:1.2;
    float line=1.-smoothstep(0.,lw+1.,dist);
    float flow=t*25.-u_time*4.;
    float dash=act>.5?.5+.5*sin(flow):.3;
    vec3 lc=act>.5?u_edgeActive:u_edgeIdle;
    float la=line*dash*(act>.5?.85:.35);
    float eg=act>.5?(1.-smoothstep(0.,14.,dist))*.12:0.;
    col+=lc*la+lc*eg;
    if(act>.5){
      for(int p=0;p<3;p++){
        float pt=fract(u_time*.12+float(p)*.33);
        float pd=length(wp-(a+ba*pt));
        float pa=(1.-smoothstep(0.,5.,pd))*(1.-pt*.6);
        col+=u_edgeActive*pa*.7;
      }
    }
  }

  // ══════════ NODES ══════════
  for(int i=0;i<${MAX_NODES};i++){
    if(i>=u_nodeN) break;
    vec2 np=u_nodePos[i];
    float st=u_nodeSt[i];
    float hv=u_nodeHv[i];
    float d=length(wp-np);
    float circle=1.-smoothstep(24.,27.,d);
    float glowR=st>1.5&&st<2.5?55.:42.;
    float ng=(1.-smoothstep(0.,glowR,d))*.35;
    float pulse=1.;
    if(st>1.5&&st<2.5){
      pulse=.7+.3*sin(u_time*3.5+float(i)*.7);
      float ring=abs(d-30.);
      float ra=(1.-smoothstep(0.,2.5,ring))*.45*pulse;
      col+=u_edgeActive*ra;
    }
    float hov=(1.-smoothstep(25.,30.,d))*hv*.5;
    int si=int(st);
    vec3 nc=si==0?vec3(.267,.275,.396):si==1?vec3(.918,.702,.031):si==2?vec3(.231,.510,.965):si==3?vec3(.133,.773,.369):si==4?vec3(.937,.267,.267):vec3(.655,.545,.980);
    col+=u_nodeFill*circle;
    col+=nc*circle*.35;
    col+=nc*(ng+hov)*pulse;
    if(st>2.5&&st<3.5){
      float ck=abs(wp.x-np.x)+abs(wp.y-np.y-2.);
      col+=vec3(.133,.773,.369)*(1.-smoothstep(2.5,3.5,ck));
    }
    if(st>3.5&&st<4.5){
      float xd=abs(wp.x-np.x)-abs(wp.y-np.y);
      float x2=abs(wp.x-np.x+wp.y-np.y);
      col+=vec3(.937,.267,.267)*max(1.-smoothstep(1.5,2.5,abs(xd)),1.-smoothstep(1.5,2.5,abs(x2)))*.7;
    }
  }

  gl_FragColor=vec4(col,alpha);
}`;

// ── WebGL Helpers ──

function mkShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('Shader:', gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function mkProgram(gl: WebGLRenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram | null {
  const p = gl.createProgram()!;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error('Program:', gl.getProgramInfoLog(p));
    gl.deleteProgram(p);
    return null;
  }
  return p;
}

function u(gl: WebGLRenderingContext, prog: WebGLProgram, name: string): WebGLUniformLocation | null {
  return gl.getUniformLocation(prog, name);
}

// ── Component ──

export default function FlowGPU(props: GPUProps) {
  const { width, height, zoom, pan, time } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const progRef = useRef<WebGLProgram | null>(null);
  const bufRef = useRef<WebGLBuffer | null>(null);
  const initRef = useRef(false);

  // Init WebGL once
  useEffect(() => {
    if (initRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const gl = canvas.getContext('webgl', { alpha: false, antialias: true, preserveDrawingBuffer: false });
      if (!gl) { console.error('No WebGL'); return; }
      glRef.current = gl;

      const vs = mkShader(gl, gl.VERTEX_SHADER, VERT);
      const fs = mkShader(gl, gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return;
      const prog = mkProgram(gl, vs, fs);
      if (!prog) return;
      progRef.current = prog;

      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      bufRef.current = buf;

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      initRef.current = true;
    } catch (e) { console.error('WebGL init:', e); }
  }, []);

  // Render every frame
  const render = useCallback(() => {
    const gl = glRef.current, prog = progRef.current, buf = bufRef.current;
    if (!gl || !prog || !buf) return;

    try {
      const tc = THEMES[props.theme] || THEMES['deep-space'];
      gl.viewport(0, 0, width, height);
      gl.clearColor(tc.bg[0], tc.bg[1], tc.bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);

      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const pos = gl.getAttribLocation(prog, 'a_pos');
      if (pos >= 0) { gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0); }

      // Uniforms
      const f = (n: string, v: number) => { const l = u(gl, prog, n); if (l) gl.uniform1f(l, v); };
      const v2 = (n: string, x: number, y: number) => { const l = u(gl, prog, n); if (l) gl.uniform2f(l, x, y); };
      const i1 = (n: string, v: number) => { const l = u(gl, prog, n); if (l) gl.uniform1i(l, v); };
      const fv2 = (n: string, v: Float32Array) => { const l = u(gl, prog, n); if (l) gl.uniform2fv(l, v); };
      const fv1 = (n: string, v: Float32Array) => { const l = u(gl, prog, n); if (l) gl.uniform1fv(l, v); };
      const fv4 = (n: string, v: Float32Array) => { const l = u(gl, prog, n); if (l) gl.uniform4fv(l, v); };
      const f3 = (n: string, x: number, y: number, z: number) => { const l = u(gl, prog, n); if (l) gl.uniform3f(l, x, y, z); };

      v2('u_res', width, height);
      f('u_time', time * 0.016);
      f('u_zoom', zoom);
      v2('u_pan', pan.x, pan.y);
      // Theme colors
      f3('u_bg', tc.bg[0], tc.bg[1], tc.bg[2]);
      f3('u_grid', tc.grid[0], tc.grid[1], tc.grid[2]);
      f3('u_nodeFill', tc.nodeFill[0], tc.nodeFill[1], tc.nodeFill[2]);
      f3('u_edgeIdle', tc.edgeIdle[0], tc.edgeIdle[1], tc.edgeIdle[2]);
      f3('u_edgeActive', tc.edgeActive[0], tc.edgeActive[1], tc.edgeActive[2]);
      f('u_cellIntensity', tc.cellIntensity);

      // Cells
      i1('u_cellN', Math.min(props.cellNodes.length, MAX_CELLS));
      const cd: number[] = [];
      const cc: number[] = [];
      for (let c = 0; c < Math.min(props.cellNodes.length, MAX_CELLS); c++) {
        const nodes = props.cellNodes[c];
        cc.push(...(props.cellColors[c] || [0.5, 0.5, 0.5]));
        for (let n = 0; n < 32; n++) {
          cd.push(n < nodes.length / 2 ? nodes[n * 2] : 0, n < nodes.length / 2 ? nodes[n * 2 + 1] : 0);
        }
      }
      fv2('u_cellNodes[0]', new Float32Array(cd));
      for (let i = 0; i < MAX_CELLS; i++) i1(`u_cellCounts[${i}]`, i < props.cellNodes.length ? Math.min(props.cellNodes[i].length / 2, 32) : 0);
      for (let i = 0; i < MAX_CELLS; i++) {
        const ci = i * 3;
        f3(`u_cellColors[${i}]`, cc[ci] || 0, cc[ci + 1] || 0, cc[ci + 2] || 0);
      }

      // Nodes
      i1('u_nodeN', Math.min(props.nodeX.length, MAX_NODES));
      const nx = new Float32Array(MAX_NODES * 2);
      for (let i = 0; i < Math.min(props.nodeX.length, MAX_NODES); i++) { nx[i * 2] = props.nodeX[i]; nx[i * 2 + 1] = props.nodeY[i]; }
      fv2('u_nodePos[0]', nx);
      const ns = new Float32Array(MAX_NODES);
      for (let i = 0; i < Math.min(props.nodeStatus.length, MAX_NODES); i++) ns[i] = props.nodeStatus[i];
      fv1('u_nodeSt[0]', ns);
      const nh = new Float32Array(MAX_NODES);
      for (let i = 0; i < Math.min(props.nodeHover.length, MAX_NODES); i++) nh[i] = props.nodeHover[i];
      fv1('u_nodeHv[0]', nh);

      // Edges
      i1('u_edgeN', Math.min(props.edgeX1.length, MAX_EDGES));
      const ed = new Float32Array(MAX_EDGES * 4);
      for (let i = 0; i < Math.min(props.edgeX1.length, MAX_EDGES); i++) {
        ed[i * 4] = props.edgeX1[i]; ed[i * 4 + 1] = props.edgeY1[i];
        ed[i * 4 + 2] = props.edgeX2[i]; ed[i * 4 + 3] = props.edgeY2[i];
      }
      fv4('u_edgeD[0]', ed);
      const ea = new Float32Array(MAX_EDGES);
      for (let i = 0; i < Math.min(props.edgeActive.length, MAX_EDGES); i++) ea[i] = props.edgeActive[i];
      fv1('u_edgeA[0]', ea);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    } catch (e) { /* silent */ }
  }, [width, height, zoom, pan, time, props.cellNodes, props.cellColors, props.nodeX, props.nodeY, props.nodeStatus, props.nodeHover, props.edgeX1, props.edgeY1, props.edgeX2, props.edgeY2, props.edgeActive]);

  useEffect(() => { render(); }, [render]);

  return (
    <>
      <canvas ref={canvasRef} width={width || 100} height={height || 100}
        className="absolute inset-0" style={{ background: 'transparent' }} />
      {/* SVG overlay — ONLY click targets + text labels, no visual rendering */}
      <svg width={width} height={height} className="absolute inset-0" style={{ zIndex: 1 }}>
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {/* Cell labels */}
          {props.cellLabels.map((l, i) => (
            <g key={`cl${i}`}>
              <text x={l.x} y={l.y - 18} textAnchor="middle" fontSize="13" fontWeight="700"
                fill={`rgb(${Math.round(l.color[0] * 255)},${Math.round(l.color[1] * 255)},${Math.round(l.color[2] * 255)})`}
                style={{ pointerEvents: 'none' }}>{l.text}</text>
            </g>
          ))}
          {/* Node labels */}
          {props.nodeLabels.map((l, i) => (
            <text key={`nl${i}`} x={l.x} y={l.y + 12} textAnchor="middle" fontSize="9"
              fontWeight="600" fill="#e2e8f0" style={{ pointerEvents: 'none' }}>{l.text}</text>
          ))}
          {/* Click targets */}
          {props.nodeX.map((x, i) => (
            <circle key={`c${i}`} cx={x} cy={props.nodeY[i] || 0} r={30}
              fill="transparent" style={{ cursor: 'pointer' }}
              data-node-idx={i} />
          ))}
        </g>
      </svg>
    </>
  );
}

export { CELL_PALETTE };
