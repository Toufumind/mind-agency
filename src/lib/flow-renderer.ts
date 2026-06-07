/**
 * Flow Renderer — WebGL shader 渲染引擎
 *
 * 分层架构：
 *   Layer 1: WebGL canvas — 所有视觉效果（细胞、箭头、节点、网格）
 *   Layer 2: SVG overlay — 仅点击区域 + 文字标签（完全透明）
 *
 * 坐标系统一：
 *   - 力仿真输出 world coordinates (x, y)
 *   - Shader 接收 world coordinates + zoom/pan
 *   - 坐标转换: screen = world * zoom + pan
 *   - 逆转换: world = (screen - pan) / zoom
 *   - 注意: gl_FragCoord.y 是 bottom-up，需要翻转
 */

export interface RenderData {
  cellNodes: number[][];      // cellNodes[i] = [x1,y1,x2,y2,...]
  cellColors: number[][];     // cellColors[i] = [r,g,b]
  nodeX: number[];
  nodeY: number[];
  nodeStatus: number[];       // 0-5
  nodeHover: number[];
  edgeX1: number[]; edgeY1: number[];
  edgeX2: number[]; edgeY2: number[];
  edgeActive: number[];
  theme: string;
  zoom: number;
  panX: number;
  panY: number;
}

// ── Theme colors ──
const THEMES: Record<string, {
  bg: number[]; grid: number[]; nodeFill: number[];
  edgeIdle: number[]; edgeActive: number[]; cellIntensity: number;
}> = {
  'deep-space':    { bg:[0.051,0.051,0.071], grid:[0.09,0.09,0.11], nodeFill:[0.059,0.09,0.165], edgeIdle:[0.2,0.22,0.27], edgeActive:[0.298,0.435,0.961], cellIntensity:0.15 },
  'nord':          { bg:[0.106,0.118,0.145], grid:[0.14,0.16,0.19], nodeFill:[0.129,0.141,0.173], edgeIdle:[0.23,0.25,0.32], edgeActive:[0.38,0.55,0.78], cellIntensity:0.18 },
  'tokyo-night':   { bg:[0.078,0.090,0.118], grid:[0.11,0.12,0.16], nodeFill:[0.090,0.102,0.133], edgeIdle:[0.20,0.22,0.28], edgeActive:[0.42,0.60,0.92], cellIntensity:0.16 },
  'dracula':       { bg:[0.114,0.106,0.141], grid:[0.15,0.14,0.18], nodeFill:[0.125,0.118,0.157], edgeIdle:[0.25,0.23,0.30], edgeActive:[0.80,0.55,0.98], cellIntensity:0.17 },
  'notion':        { bg:[0.961,0.957,0.949], grid:[0.90,0.89,0.88], nodeFill:[0.933,0.929,0.922], edgeIdle:[0.75,0.74,0.73], edgeActive:[0.298,0.435,0.961], cellIntensity:0.08 },
  'minimal-white': { bg:[0.980,0.976,0.973], grid:[0.93,0.92,0.91], nodeFill:[0.957,0.953,0.949], edgeIdle:[0.78,0.77,0.76], edgeActive:[0.298,0.435,0.961], cellIntensity:0.06 },
  'warm-wood':     { bg:[0.953,0.925,0.878], grid:[0.88,0.84,0.78], nodeFill:[0.922,0.890,0.835], edgeIdle:[0.72,0.66,0.58], edgeActive:[0.65,0.45,0.25], cellIntensity:0.10 },
  'solarized-light': { bg:[0.965,0.957,0.910], grid:[0.90,0.89,0.84], nodeFill:[0.941,0.933,0.886], edgeIdle:[0.70,0.69,0.64], edgeActive:[0.16,0.50,0.55], cellIntensity:0.07 },
};

export function getThemeColors(theme: string) {
  return THEMES[theme] || THEMES['deep-space'];
}

// ── Vertex Shader ──
export const VERT = `attribute vec2 a_pos; void main(){gl_Position=vec4(a_pos,0,1);}`;

// ── Fragment Shader ──
export const FRAG = `
precision highp float;

uniform vec2 u_res;
uniform float u_time, u_zoom;
uniform vec2 u_pan;

// Theme
uniform vec3 u_bg, u_grid, u_nodeFill, u_edgeIdle, u_edgeActive;
uniform float u_cellIntensity;

// Cells (max 8 workflows)
const int MC=8, MN=32;
uniform int u_cellN;
uniform vec2 u_cellNodes[MC*MN];
uniform int u_cellCounts[MC];
uniform vec3 u_cellColors[MC];

// Nodes (max 128)
const int MX=128;
uniform int u_nodeN;
uniform vec2 u_nodePos[MX];
uniform float u_nodeSt[MX];
uniform float u_nodeHv[MX];

// Edges (max 128)
const int EX=128;
uniform vec4 u_edgeD[EX];
uniform float u_edgeA[EX];
uniform int u_edgeN;

// ── Helpers ──
vec2 s2w(vec2 sp){return(sp-u_pan)/u_zoom;}
float metaball(vec2 p,vec2 c,float r){return r*r/(dot(p-c,p-c)+0.0001);}

void main(){
  // Flip Y: gl_FragCoord is bottom-up, our world is top-down
  vec2 sp=vec2(gl_FragCoord.x,u_res.y-gl_FragCoord.y);
  vec2 wp=s2w(sp);
  vec3 col=u_bg;

  // ══════ GRID ══════
  vec2 g=fract(wp/50.0);
  float gl_=step(0.97,g.x)+step(0.97,g.y);
  col+=u_grid*gl_*0.25;

  // ══════ CELLS ══════
  for(int c=0;c<MC;c++){
    if(c>=u_cellN)break;
    float field=0.0;
    int cnt=u_cellCounts[c];
    for(int n=0;n<MN;n++){
      if(n>=cnt)break;
      field+=metaball(wp,u_cellNodes[c*MN+n],160.0);
    }
    float pulse=.82+.18*sin(u_time*.7+float(c)*2.3);
    float cy=smoothstep(.2,.6,field)*u_cellIntensity;
    float wI=smoothstep(.45,.8,field);
    float wO=smoothstep(.8,1.3,field);
    float w=(wI-wO)*pulse;
    float gw=smoothstep(2.2,.2,wO)*.4;
    vec3 cc=u_cellColors[c];
    col+=cc*cy*.4+cc*w*2.0+cc*gw;
  }

  // ══════ EDGES ══════
  for(int e=0;e<EX;e++){
    if(e>=u_edgeN)break;
    vec4 ed=u_edgeD[e];
    vec2 a=vec2(ed.x,ed.y),b=vec2(ed.z,ed.w);
    float act=u_edgeA[e];
    vec2 ba=b-a;
    float blen=length(ba);
    if(blen<0.01)continue;
    float t=clamp(dot(wp-a,ba)/(blen*blen),0.,1.);
    float dist=length(wp-(a+t*ba));
    float lw=act>.5?2.5:1.2;
    float line=1.-smoothstep(0.,lw+1.,dist);
    float flow=t*25.-u_time*4.;
    float dash=act>.5?.5+.5*sin(flow):.3;
    vec3 lc=act>.5?u_edgeActive:u_edgeIdle;
    float la=line*dash*(act>.5?.8:.3);
    float eg=act>.5?(1.-smoothstep(0.,12.,dist))*.1:0.;
    col+=lc*la+lc*eg;
  }

  // ══════ NODES ══════
  for(int i=0;i<MX;i++){
    if(i>=u_nodeN)break;
    vec2 np=u_nodePos[i];
    float st=u_nodeSt[i];
    float hv=u_nodeHv[i];
    float d=length(wp-np);
    float circle=1.-smoothstep(24.,27.,d);
    float glowR=st>1.5&&st<2.5?50.:40.;
    float ng=(1.-smoothstep(0.,glowR,d))*.3;
    float pulse=1.;
    if(st>1.5&&st<2.5){
      pulse=.7+.3*sin(u_time*3.5+float(i)*.7);
      float ring=abs(d-30.);
      float ra=(1.-smoothstep(0.,2.5,ring))*.4*pulse;
      col+=u_edgeActive*ra;
    }
    float hov=(1.-smoothstep(25.,30.,d))*hv*.4;
    int si=int(st);
    vec3 nc=si==0?vec3(.267,.275,.396):si==1?vec3(.918,.702,.031):si==2?vec3(.231,.510,.965):si==3?vec3(.133,.773,.369):si==4?vec3(.937,.267,.267):vec3(.655,.545,.980);
    col+=u_nodeFill*circle;
    col+=nc*circle*.3;
    col+=nc*(ng+hov)*pulse;
    // Check mark for completed
    if(st>2.5&&st<3.5){
      float ck=abs(wp.x-np.x)+abs(wp.y-np.y-2.);
      col+=vec3(.133,.773,.369)*(1.-smoothstep(2.5,3.5,ck));
    }
    // X mark for failed
    if(st>3.5&&st<4.5){
      float xd=abs(wp.x-np.x)-abs(wp.y-np.y);
      float x2=abs(wp.x-np.x+wp.y-np.y);
      col+=vec3(.937,.267,.267)*max(1.-smoothstep(1.5,2.5,abs(xd)),1.-smoothstep(1.5,2.5,abs(x2)))*.7;
    }
  }

  gl_FragColor=vec4(col,1.0);
}`;

// ── WebGL Context Manager ──
export class FlowRenderer {
  private gl: WebGLRenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private buf: WebGLBuffer | null = null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private ok = false;

  init(canvas: HTMLCanvasElement): boolean {
    try {
      const gl = canvas.getContext('webgl', { alpha: false, antialias: true });
      if (!gl) return false;
      this.gl = gl;

      const vs = this.mkShader(gl, gl.VERTEX_SHADER, VERT);
      const fs = this.mkShader(gl, gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return false;
      const prog = this.mkProgram(gl, vs, fs);
      if (!prog) return false;
      this.prog = prog;

      const buf = gl.createBuffer();
      if (!buf) return false;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      this.buf = buf;

      // Cache uniform locations
      const names = ['u_res','u_time','u_zoom','u_pan','u_bg','u_grid','u_nodeFill','u_edgeIdle','u_edgeActive','u_cellIntensity','u_cellN','u_nodeN','u_edgeN'];
      for (const n of names) this.u[n] = gl.getUniformLocation(prog, n);
      for (let i = 0; i < 8; i++) this.u[`u_cellCounts[${i}]`] = gl.getUniformLocation(prog, `u_cellCounts[${i}]`);
      for (let i = 0; i < 8; i++) this.u[`u_cellColors[${i}]`] = gl.getUniformLocation(prog, `u_cellColors[${i}]`);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.ok = true;
      return true;
    } catch (e) { console.error('FlowRenderer init:', e); return false; }
  }

  render(w: number, h: number, data: RenderData, time: number) {
    const gl = this.gl, prog = this.prog, buf = this.buf;
    if (!gl || !prog || !buf || !this.ok) return;

    try {
      const tc = getThemeColors(data.theme);
      gl.viewport(0, 0, w, h);
      gl.clearColor(tc.bg[0], tc.bg[1], tc.bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);

      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const pos = gl.getAttribLocation(prog, 'a_pos');
      if (pos >= 0) { gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0); }

      // Helper functions
      const f1 = (n: string, v: number) => { const l = this.u[n]; if (l) gl.uniform1f(l, v); };
      const f2 = (n: string, x: number, y: number) => { const l = this.u[n]; if (l) gl.uniform2f(l, x, y); };
      const i1 = (n: string, v: number) => { const l = this.u[n]; if (l) gl.uniform1i(l, v); };
      const f3 = (n: string, x: number, y: number, z: number) => { const l = this.u[n]; if (l) gl.uniform3f(l, x, y, z); };
      const fv2 = (n: string, v: Float32Array) => { const l = this.u[n]; if (l) gl.uniform2fv(l, v); };
      const fv1 = (n: string, v: Float32Array) => { const l = this.u[n]; if (l) gl.uniform1fv(l, v); };
      const fv4 = (n: string, v: Float32Array) => { const l = this.u[n]; if (l) gl.uniform4fv(l, v); };

      // Uniforms
      f2('u_res', w, h);
      f1('u_time', time * 0.016);
      f1('u_zoom', data.zoom);
      f2('u_pan', data.panX, data.panY);
      f3('u_bg', tc.bg[0], tc.bg[1], tc.bg[2]);
      f3('u_grid', tc.grid[0], tc.grid[1], tc.grid[2]);
      f3('u_nodeFill', tc.nodeFill[0], tc.nodeFill[1], tc.nodeFill[2]);
      f3('u_edgeIdle', tc.edgeIdle[0], tc.edgeIdle[1], tc.edgeIdle[2]);
      f3('u_edgeActive', tc.edgeActive[0], tc.edgeActive[1], tc.edgeActive[2]);
      f1('u_cellIntensity', tc.cellIntensity);

      // Cells
      i1('u_cellN', Math.min(data.cellNodes.length, 8));
      const cd: number[] = [];
      const cc: number[] = [];
      for (let c = 0; c < Math.min(data.cellNodes.length, 8); c++) {
        const nodes = data.cellNodes[c];
        cc.push(...(data.cellColors[c] || [0.5, 0.5, 0.5]));
        for (let n = 0; n < 32; n++) {
          cd.push(n < nodes.length / 2 ? nodes[n * 2] : 0, n < nodes.length / 2 ? nodes[n * 2 + 1] : 0);
        }
      }
      fv2('u_cellNodes[0]', new Float32Array(cd));
      for (let i = 0; i < 8; i++) i1(`u_cellCounts[${i}]`, i < data.cellNodes.length ? Math.min(data.cellNodes[i].length / 2, 32) : 0);
      for (let i = 0; i < 8; i++) {
        const ci = i * 3;
        f3(`u_cellColors[${i}]`, cc[ci] || 0, cc[ci + 1] || 0, cc[ci + 2] || 0);
      }

      // Nodes
      i1('u_nodeN', Math.min(data.nodeX.length, 128));
      const nx = new Float32Array(256);
      for (let i = 0; i < Math.min(data.nodeX.length, 128); i++) { nx[i * 2] = data.nodeX[i]; nx[i * 2 + 1] = data.nodeY[i]; }
      fv2('u_nodePos[0]', nx);
      const ns = new Float32Array(128);
      for (let i = 0; i < Math.min(data.nodeStatus.length, 128); i++) ns[i] = data.nodeStatus[i];
      fv1('u_nodeSt[0]', ns);
      const nh = new Float32Array(128);
      for (let i = 0; i < Math.min(data.nodeHover.length, 128); i++) nh[i] = data.nodeHover[i];
      fv1('u_nodeHv[0]', nh);

      // Edges
      i1('u_edgeN', Math.min(data.edgeX1.length, 128));
      const ed = new Float32Array(512);
      for (let i = 0; i < Math.min(data.edgeX1.length, 128); i++) {
        ed[i * 4] = data.edgeX1[i]; ed[i * 4 + 1] = data.edgeY1[i];
        ed[i * 4 + 2] = data.edgeX2[i]; ed[i * 4 + 3] = data.edgeY2[i];
      }
      fv4('u_edgeD[0]', ed);
      const ea = new Float32Array(128);
      for (let i = 0; i < Math.min(data.edgeActive.length, 128); i++) ea[i] = data.edgeActive[i];
      fv1('u_edgeA[0]', ea);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    } catch (e) { /* silent */ }
  }

  private mkShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
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

  private mkProgram(gl: WebGLRenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram | null {
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

  destroy() {
    if (this.gl && this.prog) {
      this.gl.deleteProgram(this.prog);
      this.gl = null;
      this.prog = null;
      this.buf = null;
      this.ok = false;
    }
  }
}
