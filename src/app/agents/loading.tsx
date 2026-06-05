export default function Loading() {
  return (
    <div className="flex h-full bg-canvas">
      <div className="w-[220px] bg-surface border-r border-border animate-pulse" />
      <main className="flex-1 flex flex-col">
        <div className="h-11 bg-surface border-b border-border animate-pulse" />
        <div className="flex-1 p-5 space-y-4">
          <div className="flex justify-end"><div className="h-16 w-[60%] bg-surface rounded-2xl" /></div>
          <div className="space-y-2">
            <div className="h-4 w-24 bg-surface rounded" />
            <div className="h-20 w-[70%] bg-surface rounded-xl" />
          </div>
        </div>
        <div className="h-14 bg-surface border-t border-border" />
      </main>
    </div>
  );
}
