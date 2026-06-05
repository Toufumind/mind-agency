'use client';

import { useState, useEffect } from 'react';
import { Download, RefreshCw, X, Loader2 } from 'lucide-react';

interface UpdateInfo {
  currentVersion: string;
  newVersion: string;
  downloadUrl: string;
  releaseNotes: string;
}

interface UpdateProgress {
  status: 'downloading' | 'ready' | 'error';
  percent?: number;
  newVersion?: string;
  error?: string;
}

export default function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const mind = (window as any).mind;
    if (!mind?.update) return;

    mind.update.onAvailable((info: UpdateInfo) => {
      setUpdate(info);
      setProgress(null);
    });

    mind.update.onProgress((prog: UpdateProgress) => {
      setProgress(prog);
      if (prog.status === 'ready') {
        // Update downloaded, show restart button
      }
    });
  }, []);

  if (dismissed || (!update && !progress)) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm">
      {progress?.status === 'downloading' ? (
        <div className="bg-surface border border-border rounded-xl p-4 shadow-lg">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 size={14} className="animate-spin text-primary" />
            <span className="text-[12px] font-medium text-foreground">正在下载更新...</span>
          </div>
          <div className="w-full bg-surface-alt rounded-full h-1.5">
            <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${progress.percent || 0}%` }} />
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">{progress.percent || 0}%</p>
        </div>
      ) : progress?.status === 'ready' ? (
        <div className="bg-surface border border-border rounded-xl p-4 shadow-lg">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[12px] font-medium text-foreground">更新已下载完成</span>
          </div>
          <p className="text-[10px] text-muted-foreground mb-3">重启应用以应用更新 v{progress.newVersion}</p>
          <button onClick={() => (window as any).mind?.update?.restart()}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-medium bg-foreground text-canvas rounded-lg hover:opacity-90">
            <RefreshCw size={12} /> 立即重启
          </button>
        </div>
      ) : update ? (
        <div className="bg-surface border border-border rounded-xl p-4 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] font-medium text-foreground">发现新版本 v{update.newVersion}</span>
            <button onClick={() => setDismissed(true)} className="text-muted-foreground hover:text-muted"><X size={12} /></button>
          </div>
          <p className="text-[10px] text-muted-foreground mb-1">当前版本: v{update.currentVersion}</p>
          {update.releaseNotes && (
            <p className="text-[10px] text-muted-foreground/70 mb-3 line-clamp-3">{update.releaseNotes}</p>
          )}
          <button onClick={() => {
            (window as any).mind?.update?.download(update.downloadUrl, update.newVersion);
            setProgress({ status: 'downloading', percent: 0 });
          }}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-medium bg-foreground text-canvas rounded-lg hover:opacity-90">
            <Download size={12} /> 下载更新
          </button>
        </div>
      ) : null}
    </div>
  );
}
