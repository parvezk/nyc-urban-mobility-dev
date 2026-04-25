import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getSupabaseCredentials } from "./supabase-credentials";

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
    // Cron runs server-side, so prefer the service role key when Vercel provides it.
    const { supabaseUrl, supabaseKey } = getSupabaseCredentials();
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 3. Ping a known column from the trips table to register database activity.
    const { error } = await supabase
      .from("trips")
      .select("vendor_type", { count: "exact", head: true })
      .limit(1);

    if (error) {
      console.error("Supabase Keep-Alive Cron Query Error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log("Supabase Keep-Alive Cron Executed successfully");

    return NextResponse.json({ success: true, timestamp: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown keep-alive cron error";
    console.error("Keep-Alive Cron Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
