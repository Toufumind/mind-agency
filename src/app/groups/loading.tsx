export default function Loading() {
  return (
    <div className="flex h-screen bg-white">
      <div className="w-[220px] bg-[#fafafa] border-r border-gray-100 animate-pulse" />
      <main className="flex-1 flex flex-col">
        <div className="h-12 bg-gray-50 border-b border-gray-100" />
        <div className="flex-1 p-5 space-y-3">
          {[1,2,3,4,5].map(i => (
            <div key={i} className={`flex ${i % 2 === 0 ? 'justify-center' : 'items-start gap-3'}`}>
              {i % 2 !== 0 && <div className="w-7 h-7 rounded-full bg-gray-50 shrink-0" />}
              <div className={`h-12 rounded-xl bg-gray-50 ${i % 2 === 0 ? 'w-[40%]' : 'w-[55%]'}`} />
            </div>
          ))}
        </div>
        <div className="h-14 bg-gray-50 border-t border-gray-100" />
      </main>
    </div>
  );
}
