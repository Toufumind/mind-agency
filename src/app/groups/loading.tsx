export default function Loading() {
  return (
    <div className="flex h-full bg-canvas">
      <div className="w-[220px] bg-surface border-r border-border animate-pulse" />
      <main className="flex-1 flex flex-col">
        <div className="h-12 bg-surface border-b border-border" />
        <div className="flex-1 p-5 space-y-3">
          {[1,2,3,4,5].map(i => (
            <div key={i} className={`flex ${i % 2 === 0 ? 'justify-center' : 'items-start gap-3'}`}>
              {i % 2 !== 0 && <div className="w-7 h-7 rounded-full bg-surface shrink-0" />}
              <div className={`h-12 rounded-xl bg-surface ${i % 2 === 0 ? 'w-[40%]' : 'w-[55%]'}`} />
            </div>
          ))}
        </div>
        <div className="h-14 bg-surface border-t border-border" />
      </main>
    </div>
  );
}
