import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    // 1. Verify the request is coming from Vercel Cron
    const authHeader = request.headers.get("Authorization");
    if (
      process.env.CRON_SECRET &&
      authHeader !== `Bearer ${process.env.CRON_SECRET}`
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Initialize Supabase client
    // For a simple background cron job, we bypass the cookie-based SSR client 
    // and just use the standard supabase-js client to run a simple keep-alive query.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; // Or SERVICE_ROLE_KEY if you have one

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase credentials");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 3. Ping the database. We can query the pg_stat_activity view or just do a simple dummy query.
    // Drizzle doesn't have a direct raw ping from the frontend, but using Supabase RPC or a simple select 
    // from a basic table (or even catching an expected table not found error) counts as an API hit!
    // Often, a simple RPC call to a dummy function (if you make one) or fetching 1 row from an existing table works.
    
    // Here we use supabase.rpc to execute a dummy health check if it exists, 
    // OR we simply hit an arbitrary table to register "activity" on the PostgREST API.
    const { data, error } = await supabase.from('trips').select('id').limit(1);

    // Note: Even if 'trips' table doesn't exist yet, the API request itself 
    // counts as activity and resets the Supabase pause timer!

    if (error) {
      console.error("Supabase Keep-Alive Cron Query Error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log("Supabase Keep-Alive Cron Executed successfully");

    return NextResponse.json({ success: true, timestamp: new Date().toISOString() });
  } catch (error: any) {
    console.error("Keep-Alive Cron Error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
