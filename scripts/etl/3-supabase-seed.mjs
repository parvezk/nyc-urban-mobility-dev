import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FILE_PATH = path.join(process.cwd(), "scripts", "etl", "routed_trips.json");

async function seed() {
  console.log("📍 Connecting to Supabase Instance...");
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const data = JSON.parse(fs.readFileSync(FILE_PATH, "utf8"));
  
  console.log("🧹 Wiping old sparse dataset from Supabase...");
  await supabase.from("trips").delete().neq("vendor_type", "FLUSH_DB");
  
  console.log(`📡 Preparing to insert ${data.length} Trips into 'trips' Postgres table...`);

  // Chop into chunks to prevent payload size limits
  let successCount = 0;
  for (let i = 0; i < data.length; i += 100) {
    const chunk = data.slice(i, i + 100);
    const { error } = await supabase.from("trips").upsert(chunk);

    if (error) {
      console.error("❌ Supabase Insertion Failed on chunk:", error);
      if (error.code === "42P01")
        console.error("👉 TIP: Did you forget to CREATE TABLE trips in Supabase?");
      throw error;
    }
    successCount += chunk.length;
  }

  console.log(`✅ Supabase Seed Successful! Passed ${successCount} routes.`);
}

seed().catch(console.error);
