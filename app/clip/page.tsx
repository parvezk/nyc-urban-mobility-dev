import type { Metadata } from 'next';
import ClipLoader from '@/components/clip/ClipLoader';
import { parseFormat } from '@/lib/clip/story';

export const metadata: Metadata = {
  title: 'One day of Citi Bike',
  description: 'One day of Citi Bike rides in New York, as an 8-second loop.',
};

// /clip?format=9x16|1x1|16x9&day=<YYYY-MM-DD|busiest>  (add &record=1 for the frame-stepping recorder)
export default async function ClipPage({
  searchParams,
}: {
  searchParams: Promise<{ format?: string; record?: string; day?: string }>;
}) {
  const params = await searchParams;
  return <ClipLoader format={parseFormat(params.format)} record={params.record === '1'} day={params.day} />;
}
