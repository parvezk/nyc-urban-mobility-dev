"use client";

import dynamic from 'next/dynamic';
import type { RidesMode } from './LitePlayer';

const LitePlayer = dynamic(() => import('./LitePlayer'), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-[#050608]" />,
});

export default function LiteLoader(props: { day?: string; record: boolean; rides?: RidesMode }) {
  return <LitePlayer {...props} />;
}
