'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ForceSimulation, type ForceEdge } from '@/lib/force-simulation';
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
  const simRef = useRef<ForceSimulation|null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
  const onWheel=useCallback((e:React.WheelEvent)=>{e.preventDefault();setZoom(z=>Math.min(3,Math.max(0.15,z*(e.deltaY>0?0.92:1.08))))},[]);
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

  const W=typeof window!=='undefined'?window.innerWidth:1200;
  const H=typeof window!=='undefined'?window.innerHeight:800;

  const canvasBg=isDark?'#0a0a0f':'#f5f5f0';
  const edgeIdle=isDark?'#334155':'#d1d5db';
  const edgeActive=isDark?'#3b82f6':'#2563eb';
  const nodeText=isDark?'text-white':'text-gray-900';
  const nodeSub=isDark?'text-slate-400':'text-gray-500';

  return(
    <div ref={containerRef} className="relative flex-1 h-full overflow-hidden" style={{background:canvasBg,cursor:dragging?'grabbing':'grab'}}
      onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}>

      {/* ── SVG: cells + edges ── */}
      <svg className="absolute inset-0 w-full h-full" style={{overflow:'visible'}}>
        <defs>
          <marker id="flow-arrow-d" viewBox="0 0 10 6" refX="9" refY="3" markerWidth="8" markerHeight="6" orient="auto"><path d="M0,0 L10,3 L0,6 Z" fill={edgeIdle} opacity="0.5"/></marker>
          <marker id="flow-arrow-a" viewBox="0 0 10 6" refX="9" refY="3" markerWidth="8" markerHeight="6" orient="auto"><path d="M0,0 L10,3 L0,6 Z" fill={edgeActive}/></marker>
          <filter id="cell-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="25" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          {isDark && <filter id="node-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>}
        </defs>
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {/* ── Cell hulls ── */}
          {workflows.map((wf,wi)=>{
            const pts=wf.steps.map(s=>positions.get(`${wf.group}:${s.id}`)).filter(Boolean) as{x:number;y:number}[];
            if(pts.length<2)return null;
            const color=CELL_COLORS[wi%CELL_COLORS.length];
            const isCurrent=wf.group===selectedGroup;
            const opacity=selectedGroup?(isCurrent?1:0.08):1;
            // Convex hull
            const sorted=[...pts].sort((a,b)=>a.x-b.x||a.y-b.y);
            const cross=(o:{x:number;y:number},a:{x:number;y:number},b:{x:number;y:number})=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
            const lower:{x:number;y:number}[]=[];for(const p of sorted){while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],p)<=0)lower.pop();lower.push(p)}
            const upper:{x:number;y:number}[]=[];for(const p of [...sorted].reverse()){while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],p)<=0)upper.pop();upper.push(p)}
            const hull=lower.slice(0,-1).concat(upper.slice(0,-1));
            if(hull.length<3)return null;
            // Expand hull
            const cx_=hull.reduce((s,p)=>s+p.x,0)/hull.length;
            const cy_=hull.reduce((s,p)=>s+p.y,0)/hull.length;
            const expanded=hull.map((p,i)=>{
              const prev=hull[(i-1+hull.length)%hull.length];const next=hull[(i+1)%hull.length];
              const dx=next.x-prev.x;const dy=next.y-prev.y;const len=Math.sqrt(dx*dx+dy*dy)||1;
              const nx=-dy/len;const ny=dx/len;
              const dot=(p.x-cx_)*nx+(p.y-cy_)*ny;const sign=dot>=0?1:-1;
              return{x:p.x+nx*100*sign,y:p.y+ny*100*sign};
            });
            // Smooth path
            const n=expanded.length;let d=`M${expanded[0].x},${expanded[0].y}`;
            for(let i=0;i<n;i++){const p0=expanded[(i-1+n)%n];const p1=expanded[i];const p2=expanded[(i+1)%n];const p3=expanded[(i+2)%n];d+=` C${p1.x+(p2.x-p0.x)/6},${p1.y+(p2.y-p0.y)/6},${p2.x-(p3.x-p1.x)/6},${p2.y-(p3.y-p1.y)/6},${p2.x},${p2.y}`}
            d+=' Z';
            return(
              <g key={`cell-${wf.group}`} opacity={opacity} style={{transition:'opacity 0.5s'}}>
                <path d={d} fill={color} fillOpacity={isCurrent?0.12:0.06} stroke={color} strokeWidth={isCurrent?2.5:1.5} strokeDasharray={isCurrent?'none':'8 4'} opacity={isCurrent?0.9:0.6} filter="url(#cell-glow)" style={{transition:'all 0.3s'}}/>
                <text x={cx_} y={cy_-30} textAnchor="middle" fontSize="14" fontWeight="700" fill={color} opacity={isCurrent?1:0.5} style={{pointerEvents:'none'}}>{wf.name}</text>
                <text x={cx_} y={cy_-14} textAnchor="middle" fontSize="10" fill={color} opacity={isCurrent?0.6:0.25} style={{pointerEvents:'none'}}>{wf.steps.length} steps · #{wf.group}</text>
              </g>
            );
          })}

          {/* ── Edges ── */}
          {edges.map(e=>{
            const mx=(e.x1+e.x2)/2;const my=Math.min(e.y1,e.y2)-20;
            const pathD=`M${e.x1},${e.y1} C${e.x1},${my} ${e.x2},${my} ${e.x2},${e.y2}`;
            return(
              <g key={e.key} opacity={selectedGroup?(e.group===selectedGroup?1:0.15):0.8} style={{transition:'opacity 0.3s'}}>
                {e.active&&<path d={pathD} fill="none" stroke={edgeActive} strokeWidth="8" opacity="0.1" strokeDasharray="20 10"><animate attributeName="stroke-dashoffset" from="0" to="-30" dur="1s" repeatCount="indefinite"/></path>}
                <path d={pathD} fill="none" stroke={e.active?edgeActive:edgeIdle} strokeWidth={e.active?2.5:1.2} strokeDasharray={e.active?'10 5':'4 8'} strokeLinecap="round" markerEnd={e.active?'url(#flow-arrow-a)':'url(#flow-arrow-d)'}>
                  {e.active&&<animate attributeName="stroke-dashoffset" from="0" to="-15" dur="0.8s" repeatCount="indefinite"/>}
                </path>
              </g>
            );
          })}

          {/* ── Nodes ── */}
          {workflows.map(wf=>{
            const isCurrent=wf.group===selectedGroup;
            const gOpacity=selectedGroup?(isCurrent?1:0.1):1;
            const gBlur=selectedGroup&&!isCurrent?'blur(4px)':'none';
            return(
              <g key={wf.group} opacity={gOpacity} style={{filter:gBlur,transition:'opacity 0.5s,filter 0.5s'}}>
                {wf.steps.map(step=>{
                  const pos=positions.get(`${wf.group}:${step.id}`);if(!pos)return null;
                  const isTrigger=step.type==='trigger';
                  const status=getStatus(wf.group,step.id);
                  const isCurrent_=wf.group===selectedGroup;
                  const isActive=status==='in_progress'||status==='waiting';
                  const bg=isDark?STATUS_BG[status]:STATUS_BG_LIGHT[status];
                  const icon=getIcon(step);
                  return(
                    <g key={step.id} className="wf-node" data-nid={`${wf.group}:${step.id}`} transform={`translate(${pos.x},${pos.y})`} style={{cursor:draggingNode===`${wf.group}:${step.id}`?'grabbing':'pointer'}}
                      onMouseEnter={()=>setHoveredNode(`${wf.group}:${step.id}`)} onMouseLeave={()=>setHoveredNode(null)}
                      onClick={()=>isTrigger?onTriggerClick(wf.group):onSelectWorkflow(wf.group)}>
                      {/* Cell glow for active */}
                      {isActive&&<circle r={35} fill="none" stroke={isDark?'#3b82f6':'#2563eb'} strokeWidth="1" opacity="0.3"><animate attributeName="r" values="30;40;30" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.3;0.1;0.3" dur="2s" repeatCount="indefinite"/></circle>}
                      {/* Node circle */}
                      <circle r={27} className={bg} strokeWidth={hoveredNode===`${wf.group}:${step.id}`?2.5:1.5} strokeDasharray={isTrigger?'5 3':'none'} style={{transition:'stroke-width 0.2s'}}/>
                      {/* Icon */}
                      <text y={-5} textAnchor="middle" fontSize="15" dominantBaseline="middle" style={{pointerEvents:'none'}}>{icon}</text>
                      {/* Name */}
                      <text y={12} textAnchor="middle" fontSize="8" fontWeight="600" className={nodeText} style={{pointerEvents:'none'}}>{step.id.length>10?step.id.slice(0,10)+'…':step.id}</text>
                      {/* Status badge */}
                      {status!=='pending'&&<g transform="translate(18,-18)"><circle r="5" fill={status==='completed'?'#22c55e':status==='failed'?'#ef4444':status==='in_progress'?'#3b82f6':'#eab308'} opacity="0.9"/>{status==='completed'&&<text y="3.5" textAnchor="middle" fontSize="7" fill="#fff" fontWeight="700">✓</text>}{status==='failed'&&<text y="3.5" textAnchor="middle" fontSize="7" fill="#fff" fontWeight="700">✗</text>}{status==='in_progress'&&<circle r="2.5" fill="#fff"><animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="1.5s" repeatCount="indefinite"/></circle>}</g>}
                    </g>
                  );
                })}
              </g>
            );
          })}
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
