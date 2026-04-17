import WebGlMap from '@/components/WebGlMap';

export default function Home() {
  return (
    <main className="w-full h-screen relative">
      <div className="absolute top-4 left-4 z-10 bg-white/90 backdrop-blur p-4 rounded-lg shadow-sm border border-gray-100">
        <h1 className="text-xl font-bold tracking-tight text-gray-900">NYC Urban Mobility</h1>
      </div>
      
      {/* Client Component Map */}
      <WebGlMap />
    </main>
  );
}
