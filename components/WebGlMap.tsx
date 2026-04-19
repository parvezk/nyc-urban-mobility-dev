"use client";

import dynamic from 'next/dynamic';

const WebGlMap = dynamic(() => import('@/components/MapViewport'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-screen flex items-center justify-center bg-[#FAFAFA]">
      <p className="text-gray-500 font-medium">Booting WebGL Canvas...</p>
    </div>
  )
});

export default WebGlMap;
