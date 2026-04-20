import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Fallback: serve from local file if Supabase is not configured
  if (!supabaseUrl || !serviceKey) {
    const localTrips = path.join(process.cwd(), 'scripts', 'etl', 'routed_trips.json');
    if (fs.existsSync(localTrips)) {
      return NextResponse.json(JSON.parse(fs.readFileSync(localTrips, 'utf8')));
    }
    return NextResponse.json({ error: 'Supabase unconfigured & local file missing' }, { status: 404 });
  }

  // Use service role key to bypass Row Level Security (server-side only)
  const supabase = createClient(supabaseUrl, serviceKey);
  const { data, error } = await supabase.from('trips').select('vendor_type, path');

  if (error) {
    console.error('[/api/trips] Supabase error:', error.message);
    // Graceful fallback to local file
    const localTrips = path.join(process.cwd(), 'scripts', 'etl', 'routed_trips.json');
    if (fs.existsSync(localTrips)) {
      return NextResponse.json(JSON.parse(fs.readFileSync(localTrips, 'utf8')));
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
