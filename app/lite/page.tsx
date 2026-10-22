import type { Metadata } from 'next';
import LiteLoader from '@/components/lite/LiteLoader';

export const metadata: Metadata = {
  title: 'One day of Citi Bike',
  description: 'Every Citi Bike ride in New York on one day, in a 10-second loop.',
};

// /lite?day=<YYYY-MM-DD|busiest>&rides=<all|sample>  (add &record=1 for the frame-stepping recorder)
export default async function LitePage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; record?: string; rides?: string }>;
}) {
  const p = await searchParams;
  const rides = p.rides === 'all' || p.rides === 'sample' ? p.rides : undefined;
  return (
    <>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" precedence="default" />
      <div style={{ fontFamily: "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
        <LiteLoader day={p.day} record={p.record === '1'} rides={rides} />
      </div>
    </>
  );
}
