"use client";

import dynamic from 'next/dynamic';
import type { ClipFormat } from '@/lib/clip/story';

const ClipStage = dynamic(() => import('./ClipStage'), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-[#07080a]" />,
});

export default function ClipLoader({ format, record }: { format: ClipFormat; record: boolean }) {
  return <ClipStage format={format} record={record} />;
}
