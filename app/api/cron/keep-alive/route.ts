import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getSupabaseCredentials } from "./supabase-credentials";

/** Avoid static/route caching so each cron tick hits the runtime and PostgREST (Vercel + Next.js cron guidance). */
export const dynamic = "force-dynamic";

function cronSecretMatchesAuthorization(request: Request, secret: string): boolean {
  const authHeader = request.headers.get("authorization");
  const match = authHeader?.match(/^Bearer\s+(.*)$/i);
  const token = match?.[1]?.trim();
  return token === secret.trim();
}

export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET?.trim();
    const userAgent = request.headers.get("user-agent") ?? "";
    const isVercelCronUserAgent = userAgent.includes("vercel-cron");

    // Prefer CRON_SECRET (Vercel injects Authorization: Bearer … on cron invocations). Trim env to avoid stray newlines breaking auth (Vercel KB).
    const authorized =
      cronSecret !== undefined && cronSecret.length > 0
        ? cronSecretMatchesAuthorization(request, cronSecret)
        : isVercelCronUserAgent;

    if (!authorized) {
      console.error("Keep-Alive Cron: Unauthorized (check CRON_SECRET and Vercel production env)");
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
