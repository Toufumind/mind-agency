'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ForceSimulation, type ForceEdge } from '@/lib/force-simulation';
import { FlowRenderer, getThemeColors, type RenderData } from '@/lib/flow-renderer';
import { useTheme } from '@/lib/theme';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

// ── Types ──
interface WorkflowStep {
  id: string; type?: string; agent?: string; action?: string; prompt?: string;
  dependsOn?: string[]; routes?: { step: string; when: string }[];
  reviewer?: string; priority?: string; trigger?: any;
}
interface WorkflowDef { group: string; name: string; description?: string; steps: WorkflowStep[]; position?: { x: number; y: number }; }
interface RunInfo { runId: string; status: string; steps: Record<string, string>; startedAt: number; completedAt?: number; }
interface FlowCanvasProps {
  workflows: WorkflowDef[]; runs: Record<string, RunInfo[]>;
  onSelectWorkflow: (g: string | null) => void; selectedGroup: string | null;
  onTrigger: (g: string, triggerStepId?: string) => void;
}

const CELL_COLORS = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#14b8a6'];
const STATUS_BG: Record<string, string> = {
  pending: 'fill-slate-800 stroke-slate-600', waiting: 'fill-slate-800 stroke-yellow-500',
  in_progress: 'fill-slate-800 stroke-blue-500', completed: 'fill-slate-800 stroke-green-500',
  failed: 'fill-slate-800 stroke-red-500', skipped: 'fill-slate-800 stroke-slate-600',
};
const STATUS_BG_LIGHT: Record<string, string> = {
  pending: 'fill-white stroke-gray-300', waiting: 'fill-white stroke-yellow-400',
  in_progress: 'fill-white stroke-blue-500', completed: 'fill-white stroke-green-500',
  failed: 'fill-white stroke-red-500', skipped: 'fill-white stroke-gray-300',
};
const ICONS: Record<string, string> = { trigger:'⚡',test:'🧪',build:'📦',deploy:'🚀',review:'🔍',fix:'🔧',verify:'✅',notify:'📢',research:'📚',synthesize:'📝',present:'📊',done:'🏁',human_approval:'👤',default:'📋' };
function getIcon(s: WorkflowStep): string { if(s.type==='trigger') return '⚡'; const a=(s.action||'').toLowerCase(); for(const[k,v] of Object.entries(ICONS)) if(a.includes(k)) return v; return ICONS.default; }
function fmtTime(ms: number): string { const s=Math.round(ms/1000); return s<60?`${s}s`:`${Math.floor(s/60)}m${s%60?` ${s%60}s`:''}`; }

export default function FlowCanvas({ workflows, runs, onSelectWorkflow, selectedGroup, onTrigger }: FlowCanvasProps) {
  const { theme } = useTheme();
  const isDark = !['notion','minimal-white','warm-wood','solarized-light'].includes(theme);
  const [positions, setPositions] = useState<Map<string,{x:number;y:number}>>(new Map());
  const [zoom, setZoom] = useState(()=>{try{return parseFloat(localStorage.getItem('flow-zoom')||'1')}catch{return 1}});
  const [pan, setPan] = useState(()=>{try{return JSON.parse(localStorage.getItem('flow-pan')||'{"x":0,"y":0}')}catch{return{x:0,y:0}}});
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({x:0,y:0});
  const [hoveredNode, setHoveredNode] = useState<string|null>(null);
  const [draggingNode, setDraggingNode] = useState<string|null>(null);
  const [triggerPopup, setTriggerPopup] = useState<{group:string;triggers:WorkflowStep[]}|null>(null);
  const [time, setTime] = useState(0);
  const simRef = useRef<ForceSimulation|null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Animation timer
  useEffect(() => { const id = setInterval(() => setTime(t => t + 1), 50); return () => clearInterval(id); }, []);

  // Throttled position update — only re-render every 3rd frame
  const frameCount = useRef(0);
  useEffect(()=>{const h=(e:KeyboardEvent)=>{if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement)return;if(e.key==='Escape'){onSelectWorkflow(null);setTriggerPopup(null)}if(e.key==='+'||e.key==='=')setZoom(z=>Math.min(3,z*1.2));if(e.key==='-')setZoom(z=>Math.max(0.15,z/1.2));if(e.key==='0'){setZoom(1);setPan({x:0,y:0})}};window.addEventListener('keydown',h);return()=>window.removeEventListener('keydown',h)},[onSelectWorkflow]);
  // Native wheel listener (React onWheel is passive, can't preventDefault)
  useEffect(()=>{const el=containerRef.current;if(!el)return;const h=(e:WheelEvent)=>{e.preventDefault();setZoom(z=>Math.min(3,Math.max(0.15,z*(e.deltaY>0?0.92:1.08))))};el.addEventListener('wheel',h,{passive:false});return()=>el.removeEventListener('wheel',h)},[]);
  useEffect(()=>{try{localStorage.setItem('flow-pan',JSON.stringify(pan))}catch{}},[pan]);
  useEffect(()=>{try{localStorage.setItem('flow-zoom',String(zoom))}catch{}},[zoom]);

  useEffect(()=>{
    try{
      const sim=new ForceSimulation({repulsion:2500,attraction:0.02,gravity:0.015,linkDistance:180,damping:0.9,maxVelocity:8,interGroupRepulsion:15,groupGravity:0.08,centerX:500,centerY:400});
      const allNodes:{id:string;group:string}[]=[];const allEdges:ForceEdge[]=[];
      for(const wf of workflows){for(const step of wf.steps){allNodes.push({id:`${wf.group}:${step.id}`,group:wf.group});for(const dep of step.dependsOn||[])allEdges.push({source:`${wf.group}:${dep}`,target:`${wf.group}:${step.id}`})}}
      // Group nodes by workflow, space groups apart initially
      const groupStart: Record<string, number> = {};
      let gIdx = 0;
      for (const wf of workflows) { groupStart[wf.group] = gIdx; gIdx += 500; }
      sim.setNodes(allNodes.map((n,i)=>{
        const gs = groupStart[n.group] || 0;
        return { id: n.id, group: n.group, x: 200 + gs + (Math.random()-0.5)*200, y: 200 + (i % 20) * 70 };
      }));
      sim.setEdges(allEdges);
      sim.onTick((nodes)=>{frameCount.current++;if(frameCount.current%3!==0)return;const pos=new Map<string,{x:number;y:number}>();for(const[id,n]of nodes)pos.set(id,{x:n.x,y:n.y});setPositions(pos)});
      sim.start();simRef.current=sim;return()=>sim.stop();
    }catch(e){console.error('Sim:',e)}
  },[workflows]);

  const onDown=useCallback((e:React.MouseEvent)=>{
    const nodeEl=(e.target as HTMLElement).closest('.wf-node');
    if(nodeEl){const nid=nodeEl.getAttribute('data-nid');if(nid){setDraggingNode(nid);e.stopPropagation();return}}
    setDragging(true);setDragStart({x:e.clientX-pan.x,y:e.clientY-pan.y});
  },[pan]);
  const onMove=useCallback((e:React.MouseEvent)=>{
    if(draggingNode){
      const sim=simRef.current;if(!sim)return;
      const wx=(e.clientX-pan.x)/zoom;const wy=(e.clientY-pan.y)/zoom;
      sim.pin(draggingNode,wx,wy);
      setPositions(prev=>{const next=new Map(prev);next.set(draggingNode!,{x:wx,y:wy});return next});
    } else if(dragging){setPan({x:e.clientX-dragStart.x,y:e.clientY-dragStart.y})}
  },[dragging,dragStart,draggingNode,pan,zoom]);
  const onUp=useCallback(()=>{
    if(draggingNode&&simRef.current){simRef.current.unpin(draggingNode)}
    setDraggingNode(null);setDragging(false);
  },[draggingNode]);
  // onWheel removed — using native event listener with {passive:false}
  const getStatus=useCallback((g:string,s:string)=>runs[g]?.[0]?.steps?.[s]||'pending',[runs]);

  const onTriggerClick=useCallback((group:string)=>{const wf=workflows.find(w=>w.group===group);if(!wf)return;const t=wf.steps.filter(s=>s.type==='trigger');if(t.length===1)onTrigger(group,t[0].id);else if(t.length>1)setTriggerPopup({group,triggers:t});else onTrigger(group)},[workflows,onTrigger]);

  // Build edge data
  const edges=useMemo(()=>{
    const result:{x1:number;y1:number;x2:number;y2:number;active:boolean;key:string;group:string}[]=[];
    for(const wf of workflows){for(const step of wf.steps){
      const to=positions.get(`${wf.group}:${step.id}`);if(!to)continue;
      for(const dep of step.dependsOn||[]){
        const from=positions.get(`${wf.group}:${dep}`);if(!from)continue;
        const run=runs[wf.group]?.[0];const fs_=run?.steps?.[dep]||'pending';const ts=run?.steps?.[step.id]||'pending';
        result.push({x1:from.x,y1:from.y+27,x2:to.x,y2:to.y-27,active:fs_==='completed'&&(ts==='in_progress'||ts==='waiting'),key:`${wf.group}:${dep}->${step.id}`,group:wf.group});
      }
    }}return result;
  },[workflows,positions,runs]);

  // Group edges by workflow for cell rendering
  const cellEdges=useMemo(()=>{
    const map=new Map<string,{x1:number;y1:number;x2:number;y2:number;active:boolean}[]>();
    for(const e of edges){if(!map.has(e.group))map.set(e.group,[]);map.get(e.group)!.push(e)}
    return map;
  },[edges]);

  const canvasBg=isDark?'#0a0a0f':'#f5f5f0';
  const edgeIdle=isDark?'#334155':'#d1d5db';
  const edgeActive=isDark?'#3b82f6':'#2563eb';
  const nodeText=isDark?'text-white':'text-gray-900';
  const nodeSub=isDark?'text-slate-400':'text-gray-500';

  // WebGL renderer ref
  const rendererRef = useRef<FlowRenderer | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Init renderer
  useEffect(() => {
    if (rendererRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = new FlowRenderer();
    if (r.init(canvas)) rendererRef.current = r;
    return () => { r.destroy(); rendererRef.current = null; };
  }, []);

  // Render loop
  useEffect(() => {
    const r = rendererRef.current;
    const canvas = canvasRef.current;
    if (!r || !canvas) return;

    const renderData: RenderData = {
      cellNodes: workflows.map((wf) => {
        const pts: number[] = [];
        for (const step of wf.steps) {
          const p = positions.get(`${wf.group}:${step.id}`);
          if (p) pts.push(p.x, p.y);
        }
        return pts;
      }),
      cellColors: workflows.map((_, i) => {
        const C = [[0.388,0.400,0.945],[0.545,0.361,0.965],[0.925,0.282,0.600],[0.961,0.620,0.043],[0.063,0.725,0.502],[0.231,0.510,0.965]];
        return C[i % C.length];
      }),
      nodeX: workflows.flatMap(wf => wf.steps.map(s => positions.get(`${wf.group}:${s.id}`)?.x ?? 0)),
      nodeY: workflows.flatMap(wf => wf.steps.map(s => positions.get(`${wf.group}:${s.id}`)?.y ?? 0)),
      nodeStatus: workflows.flatMap(wf => wf.steps.map(s => {
        const isTrigger = s.type === 'trigger';
        const status = getStatus(wf.group, s.id);
        return isTrigger ? 5 : ({ pending: 0, waiting: 1, in_progress: 2, completed: 3, failed: 4 } as Record<string, number>)[status] || 0;
      })),
      nodeHover: workflows.flatMap(wf => wf.steps.map(s => hoveredNode === `${wf.group}:${s.id}` ? 1 : 0)),
      edgeX1: edges.map(e => e.x1), edgeY1: edges.map(e => e.y1),
      edgeX2: edges.map(e => e.x2), edgeY2: edges.map(e => e.y2),
      edgeActive: edges.map(e => e.active ? 1 : 0),
      theme: theme,
    };

    r.render(canvas.width, canvas.height, renderData, time);
  }, [workflows, positions, edges, theme, time, hoveredNode, getStatus]);

  const W = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const H = typeof window !== 'undefined' ? window.innerHeight : 800;

  return (
    <div ref={containerRef} className="relative flex-1 h-full overflow-hidden" style={{background:canvasBg,cursor:dragging?'grabbing':'grab'}}
      onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}>

      {/* ── WebGL canvas ── */}
      <canvas ref={canvasRef} width={W} height={H} className="absolute inset-0" style={{zIndex:0}} />

      {/* ── SVG overlay: labels + click targets ── */}
      <svg width={W} height={H} className="absolute inset-0" style={{zIndex:1}}>
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {/* Cell labels */}
          {workflows.map((wf, wi) => {
            const pts = wf.steps.map(s => positions.get(`${wf.group}:${s.id}`)).filter(Boolean) as { x: number; y: number }[];
            if (pts.length === 0) return null;
            const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
            const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
            const C = [[0.388,0.400,0.945],[0.545,0.361,0.965],[0.925,0.282,0.600],[0.961,0.620,0.043],[0.063,0.725,0.502],[0.231,0.510,0.965]];
            const c = C[wi % C.length];
            const col = `rgb(${Math.round(c[0]*255)},${Math.round(c[1]*255)},${Math.round(c[2]*255)})`;
            const isCurrent = wf.group === selectedGroup;
            return (
              <g key={`lbl-${wf.group}`} opacity={isCurrent ? 1 : 0.5} style={{transition:'opacity 0.5s'}}>
                <text x={cx} y={cy - 35} textAnchor="middle" fontSize="13" fontWeight="700" fill={col} style={{pointerEvents:'none'}}>{wf.name}</text>
                <text x={cx} y={cy - 20} textAnchor="middle" fontSize="9" fill={col} opacity="0.5" style={{pointerEvents:'none'}}>{wf.steps.length} steps · #{wf.group}</text>
              </g>
            );
          })}

          {/* Node labels */}
          {workflows.flatMap(wf => wf.steps.map(step => {
            const pos = positions.get(`${wf.group}:${step.id}`);
            if (!pos) return null;
            return <text key={`nl-${wf.group}:${step.id}`} x={pos.x} y={pos.y + 12} textAnchor="middle" fontSize="9" fontWeight="600" fill={isDark ? '#e2e8f0' : '#374151'} style={{pointerEvents:'none'}}>{step.id.length > 10 ? step.id.slice(0, 10) + '…' : step.id}</text>;
          }))}

          {/* Click targets */}
          {workflows.flatMap(wf => wf.steps.map(step => {
            const pos = positions.get(`${wf.group}:${step.id}`);
            if (!pos) return null;
            const isTrigger = step.type === 'trigger';
            return <circle key={`hit-${wf.group}:${step.id}`} cx={pos.x} cy={pos.y} r={30} fill="transparent" style={{cursor:'pointer'}}
              data-nid={`${wf.group}:${step.id}`}
              onMouseEnter={() => setHoveredNode(`${wf.group}:${step.id}`)}
              onMouseLeave={() => setHoveredNode(null)}
              onClick={() => isTrigger ? onTriggerClick(wf.group) : onSelectWorkflow(wf.group)} />;
          }))}
        </g>
      </svg>

      {/* ── Zoom controls ── */}
      <div className={`absolute bottom-4 left-4 flex items-center gap-1 backdrop-blur-md rounded-xl border p-1.5 shadow-lg z-10 ${isDark?'bg-slate-900/80 border-slate-700/50':'bg-white/80 border-gray-200'}`}>
        <button onClick={()=>setZoom(z=>Math.min(3,z*1.2))} className={`p-1.5 rounded-lg transition ${isDark?'hover:bg-slate-800':'hover:bg-gray-100'}`}><ZoomIn size={14} className={isDark?'text-slate-400':'text-gray-500'}/></button>
        <span className={`text-[10px] w-10 text-center font-mono ${isDark?'text-slate-500':'text-gray-400'}`}>{Math.round(zoom*100)}%</span>
        <button onClick={()=>setZoom(z=>Math.max(0.15,z/1.2))} className={`p-1.5 rounded-lg transition ${isDark?'hover:bg-slate-800':'hover:bg-gray-100'}`}><ZoomOut size={14} className={isDark?'text-slate-400':'text-gray-500'}/></button>
        <div className={`w-px h-4 mx-0.5 ${isDark?'bg-slate-700':'bg-gray-200'}`}/>
        <button onClick={()=>{setZoom(1);setPan({x:0,y:0})}} className={`p-1.5 rounded-lg transition ${isDark?'hover:bg-slate-800':'hover:bg-gray-100'}`}><Maximize2 size={14} className={isDark?'text-slate-400':'text-gray-500'}/></button>
      </div>

      {/* ── Trigger popup ── */}
      {triggerPopup&&(
        <div className="absolute inset-0 z-50 flex items-center justify-center" style={{background:'rgba(0,0,0,0.4)',backdropFilter:'blur(4px)'}} onClick={()=>setTriggerPopup(null)}>
          <div className={`border rounded-2xl p-5 shadow-2xl w-72 ${isDark?'bg-slate-900 border-slate-700/50':'bg-white border-gray-200'}`} onClick={e=>e.stopPropagation()}>
            <h3 className={`text-[13px] font-semibold mb-3 ${isDark?'text-slate-200':'text-gray-800'}`}>选择触发入口</h3>
            {triggerPopup.triggers.map(t=>(
              <button key={t.id} onClick={()=>{onTrigger(triggerPopup.group,t.id);setTriggerPopup(null)}} className={`w-full text-left px-3 py-2.5 rounded-xl text-[12px] flex items-center gap-2.5 mb-1.5 transition ${isDark?'hover:bg-slate-800 text-slate-300':'hover:bg-gray-100 text-gray-700'}`}>
                {t.id}{t.trigger?.cron&&<span className={`text-[10px] ml-auto font-mono ${isDark?'text-slate-500':'text-gray-400'}`}>{t.trigger.cron}</span>}
              </button>
            ))}
            <button onClick={()=>setTriggerPopup(null)} className={`w-full mt-3 px-3 py-2 text-[11px] rounded-xl transition ${isDark?'text-slate-500 hover:bg-slate-800':'text-gray-400 hover:bg-gray-100'}`}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}
