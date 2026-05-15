type SupabaseCronEnv = Record<string, string | undefined>;

function trimValue(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

/** Normalize URL so supabase-js does not build invalid REST paths after copy/paste. */
export function normalizeSupabaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function getSupabaseCredentials(env: SupabaseCronEnv = process.env) {
  const trimmedUrl = trimValue(env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseUrl = trimmedUrl ? normalizeSupabaseUrl(trimmedUrl) : undefined;
  const supabaseKey =
    trimValue(env.SUPABASE_SERVICE_ROLE_KEY) ??
    trimValue(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ??
    trimValue(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase credentials");
  }

  return { supabaseUrl, supabaseKey };
}
