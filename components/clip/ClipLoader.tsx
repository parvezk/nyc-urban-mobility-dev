"use client";

import dynamic from 'next/dynamic';
import type { ClipFormat } from '@/lib/clip/story';

const ClipStage = dynamic(() => import('./ClipStage'), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-[#07080a]" />,
});

export default function ClipLoader({ format, record, day }: { format: ClipFormat; record: boolean; day?: string }) {
  return <ClipStage format={format} record={record} day={day} />;
}
