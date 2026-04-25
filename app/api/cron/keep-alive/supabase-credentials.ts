type SupabaseCronEnv = Record<string, string | undefined>;

export function getSupabaseCredentials(env: SupabaseCronEnv = process.env) {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase credentials");
  }

  return { supabaseUrl, supabaseKey };
}
