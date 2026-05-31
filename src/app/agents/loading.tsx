export default function Loading() {
  return (
    <div className="flex h-screen bg-white">
      <div className="w-[220px] bg-[#fafafa] border-r border-gray-100 animate-pulse" />
      <main className="flex-1 flex flex-col">
        <div className="h-11 bg-gray-50 border-b border-gray-100 animate-pulse" />
        <div className="flex-1 p-5 space-y-4">
          <div className="flex justify-end"><div className="h-16 w-[60%] bg-gray-50 rounded-2xl" /></div>
          <div className="space-y-2">
            <div className="h-4 w-24 bg-gray-50 rounded" />
            <div className="h-20 w-[70%] bg-gray-50 rounded-xl" />
          </div>
        </div>
        <div className="h-14 bg-gray-50 border-t border-gray-100" />
      </main>
    </div>
  );
}
