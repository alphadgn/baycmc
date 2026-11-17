import { createClient } from "@supabase/supabase-js";
import { parseClubConfiguration } from "@/lib/club-configuration";

export async function readClubConfiguration() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"];
  if (!url || !key) throw new Error("Club settings unavailable");
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
      headers.set("apikey", key);
      return fetch(input, { ...init, headers });
    } },
  });
  const { data, error } = await db.rpc("club_configuration");
  if (error) throw new Error(error.message);
  return parseClubConfiguration(data);
}
export async function activeCollections() {
  return (await readClubConfiguration()).collections.filter((c) => c.active);
}
