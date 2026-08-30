import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Fallback: serve from local file if Supabase is not configured
  if (!supabaseUrl || !anonKey) {
    const localTrips = path.join(process.cwd(), 'scripts', 'etl', 'routed_trips.json');
    if (fs.existsSync(localTrips)) {
      return NextResponse.json(JSON.parse(await fs.promises.readFile(localTrips, 'utf8')));
    }
    return NextResponse.json({ error: 'Supabase unconfigured & local file missing' }, { status: 404 });
  }

  // Use anon key so RLS policies are enforced
  const supabase = createClient(supabaseUrl, anonKey);

  // Supabase caps each response at its configured max rows (default 1,000),
  // so page through with .range() until a short page signals the end.
  const PAGE_SIZE = 1000;
  const allTrips: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('trips')
      .select('vendor_type, path')
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error('[/api/trips] Supabase error:', error.message);
      // Graceful fallback to local file
      const localTrips = path.join(process.cwd(), 'scripts', 'etl', 'routed_trips.json');
      if (fs.existsSync(localTrips)) {
        return NextResponse.json(JSON.parse(await fs.promises.readFile(localTrips, 'utf8')));
      }
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }

    allTrips.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return NextResponse.json(allTrips);
}
