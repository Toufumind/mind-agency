'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';

// ---- defaults ----
const D = { camZ: -25, noiseScale: 0.2, noiseAmp: 3.0, flowSpeed: 0.2, rotateSpeed: 0.3, steps: 80 };

// ---- GLSL template with {{placeholders}} ----
const VERT = `attribute vec2 a_position;void main(){gl_Position=vec4(a_position,0.0,1.0);}`;

function frag(p: Record<string, number>) {
  const u = (k: string) => (p[k] ?? D[k as keyof typeof D]).toFixed(k === 'steps' ? 1 : 2);
  return `precision highp float;uniform float uTime;uniform vec2 uResolution;
vec3 palette(float d){return mix(vec3(0.2,0.7,0.9),vec3(1.,0.,1.),d);}
vec2 rotate(vec2 p,float a){float c=cos(a);float s=sin(a);return p*mat2(c,s,-s,c);}
float hash(vec3 p){p=fract(p*0.3183099+0.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 x){vec3 i=floor(x);vec3 f=fract(x);f=f*f*(3.0-2.0*f);return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float v=0.0;float a=0.5;vec3 shift=vec3(100.0);for(int i=0;i<5;++i){v+=a*noise(p);p=p*2.0+shift;a*=0.5;}return v;}
float map(vec3 p){float sphere=length(p);vec3 q=p*${u('noiseScale')};float n=fbm(q+vec3(uTime*${u('flowSpeed')}));float d=sphere-n*${u('noiseAmp')};return d;}
vec4 rm(vec3 ro,vec3 rd){float t=0.;vec3 col=vec3(0.);float d;for(float i=0.;i<${u('steps')};i++){vec3 p=ro+rd*t;d=map(p);if(d<0.02||t>100.0)break;col+=palette(length(p)*0.1)/(300.*d);t+=d;}return vec4(col,1./(d*100.));}
void main(){vec2 uv=(gl_FragCoord.xy-uResolution.xy/2.)/uResolution.x;vec3 ro=vec3(0.,0.,${u('camZ')});ro.xz=rotate(ro.xz,uTime*${u('rotateSpeed')});vec3 cf=normalize(-ro);vec3 cs=normalize(cross(cf,vec3(0.,1.,0.)));vec3 cu=normalize(cross(cf,cs));vec3 uuv=ro+cf*3.+uv.x*cs+uv.y*cu;vec3 rd=normalize(uuv-ro);vec4 col=rm(ro,rd);gl_FragColor=col;}`;
}

// ---- Param-controlled logo (unmount/remount on key change) ----
function ParamLogo({ size, params }: { size: number; params: Record<string, number> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as WebGLRenderingContext;
    if (!gl) return;

    // Compile
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, VERT); gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, frag(params)); gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(fs)); return; }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.deleteShader(vs); gl.deleteShader(fs);

    // Quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    const ap = gl.getAttribLocation(prog, 'a_position');
    if (ap >= 0) { gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0); }

    const tLoc = gl.getUniformLocation(prog, 'uTime');
    const rLoc = gl.getUniformLocation(prog, 'uResolution');
    const t0 = performance.now();
    let active = true;

    (function loop() {
      if (!active) return;
      gl.uniform1f(tLoc, (performance.now() - t0) / 1000);
      gl.uniform2f(rLoc, canvas!.width, canvas!.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      rafRef.current = requestAnimationFrame(loop);
    })();

    return () => { active = false; cancelAnimationFrame(rafRef.current); gl.deleteProgram(prog); };
  }, [size, params]); // remounts when params change (key controls this)

  return <canvas ref={canvasRef} width={size * 2} height={size * 2} style={{ width: size, height: size, display: 'block', borderRadius: 8 }} />;
}

// ---- Sliders ----
interface SD { key: string; label: string; min: number; max: number; step: number; hint: string; }
const SLIDERS: SD[] = [
  { key: 'camZ', label: '摄像机距离', min: -50, max: -5, step: 0.5, hint: '越接近 0 = 球越大' },
  { key: 'noiseAmp', label: '噪波振幅', min: 0.5, max: 8, step: 0.1, hint: '表面扭曲程度' },
  { key: 'noiseScale', label: '噪波频率', min: 0.05, max: 0.8, step: 0.01, hint: '纹理细致程度' },
  { key: 'flowSpeed', label: '流动速度', min: 0, max: 1, step: 0.01, hint: '噪波动画速度' },
  { key: 'rotateSpeed', label: '旋转速度', min: 0, max: 1, step: 0.01, hint: '摄像机旋转速度' },
  { key: 'steps', label: '步进次数', min: 10, max: 150, step: 5, hint: '光线步进精度' },
];

// ---- Page ----
export default function LogoPreviewPage() {
  const [params, setParams] = useState<Record<string, number>>({ ...D });
  const [remountKey, setRemountKey] = useState(0);
  const SZ = 400;

  const set = useCallback((k: string, v: number) => {
    setParams(p => ({ ...p, [k]: v }));
    setRemountKey(x => x + 1);
  }, []);

  const reset = useCallback(() => {
    setParams({ ...D });
    setRemountKey(x => x + 1);
  }, []);

  return (
    <div style={{ background: '#0a0a0f', minHeight: '100vh', color: '#e0e0e0', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>Logo 参数调试</h1>
        <p style={{ color: '#666', fontSize: 13, marginBottom: 28 }}>拖动滑块实时调整着色器参数，调满意后告诉我数值</p>

        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginBottom: 28 }}>
          {/* Canvas */}
          <div style={{ flex: '0 0 auto' }}>
            <div style={{ background: 'radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a0f 70%)', borderRadius: 16, padding: 16, border: '1px solid #1e1e30' }}>
              <ParamLogo key={remountKey} size={SZ} params={params} />
            </div>
          </div>

          {/* Sliders */}
          <div style={{ flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {SLIDERS.map(s => (
              <div key={s.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: '#bbb' }}>{s.label}</label>
                  <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#7ec8e3', minWidth: 42, textAlign: 'right' }}>
                    {params[s.key]?.toFixed(s.step < 1 ? s.step.toString().length - 2 : 0)}
                  </span>
                </div>
                <input type="range" min={s.min} max={s.max} step={s.step} value={params[s.key] ?? D[s.key as keyof typeof D]}
                  onChange={e => set(s.key, parseFloat(e.target.value))} style={{ width: '100%', accentColor: '#7ec8e3' }} />
                <p style={{ margin: 0, fontSize: 10, color: '#555' }}>{s.hint}</p>
              </div>
            ))}
            <button onClick={reset} style={{ marginTop: 4, padding: '8px 16px', borderRadius: 8, background: '#1e1e30', color: '#ccc', border: '1px solid #333', cursor: 'pointer', fontSize: 12, alignSelf: 'flex-start' }}>恢复默认值</button>
          </div>
        </div>

        {/* JSON */}
        <div style={{ background: '#111118', borderRadius: 12, padding: 16, border: '1px solid #1e1e30', marginBottom: 28 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#aaa' }}>当前参数 (复制给我)</h2>
          <pre style={{ fontSize: 12, color: '#7ec8e3', margin: 0, fontFamily: 'monospace', lineHeight: 1.8 }}>{JSON.stringify(params, null, 2)}</pre>
        </div>

        <div style={{ textAlign: 'center' }}>
          <Link href="/" style={{ color: '#666', fontSize: 13, textDecoration: 'none' }}>← 返回首页</Link>
        </div>
      </div>
    </div>
  );
}
