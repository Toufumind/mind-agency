export default function Loading() {
  return (
    <div className="flex h-screen bg-white">
      <div className="w-[220px] bg-[#fafafa] border-r border-gray-100 animate-pulse" />
      <main className="flex-1 px-8 py-10">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="h-8 w-48 bg-gray-100 rounded-lg" />
          <div className="grid grid-cols-5 gap-3">
            {[1,2,3,4,5].map(i => <div key={i} className="h-24 bg-gray-50 border border-gray-100 rounded-2xl" />)}
          </div>
          <div className="grid grid-cols-3 gap-6">
            {[1,2,3].map(i => <div key={i} className="h-64 bg-gray-50 border border-gray-100 rounded-2xl" />)}
          </div>
        </div>
      </main>
    </div>
  );
}
