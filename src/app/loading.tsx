import LogoCanvas from '@/components/logo-canvas';

export default function Loading() {
  return (
    <div className="flex h-full bg-canvas items-center justify-center">
      <div className="flex flex-col items-center gap-6">
        <LogoCanvas size={96} />
        <p className="text-[13px] text-muted-foreground animate-pulse">加载中…</p>
      </div>
    </div>
  );
}
