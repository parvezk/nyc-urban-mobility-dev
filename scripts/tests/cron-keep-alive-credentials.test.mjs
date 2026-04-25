import assert from "node:assert/strict";

import { getSupabaseCredentials } from "../../app/api/cron/keep-alive/supabase-credentials.ts";

const baseEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
};

assert.deepEqual(
  getSupabaseCredentials({
    ...baseEnv,
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  }),
  {
    supabaseUrl: baseEnv.NEXT_PUBLIC_SUPABASE_URL,
    supabaseKey: "service-role-key",
  },
  "cron route should prefer the server-only service role key",
);

assert.deepEqual(
  getSupabaseCredentials({
    ...baseEnv,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  }),
  {
    supabaseUrl: baseEnv.NEXT_PUBLIC_SUPABASE_URL,
    supabaseKey: "anon-key",
  },
  "cron route should support the same anon-key fallback as the rest of the app",
);

assert.throws(
  () => getSupabaseCredentials({ ...baseEnv }),
  /Missing Supabase credentials/,
  "cron route should fail clearly when no usable key is configured",
);
