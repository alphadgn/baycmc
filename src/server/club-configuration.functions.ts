import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clubConfigurationSchema, parseClubConfiguration, type ClubConfiguration } from "@/lib/club-configuration";
import type { Json } from "@/integrations/supabase/types";

export const getClubConfiguration = createServerFn({ method: "GET" }).handler(async () => {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"];
  const url = process.env["SUPABASE_URL"];
  if (!key || !url) throw new Error("Club settings unavailable");
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
});

export const saveClubConfiguration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ClubConfiguration) => clubConfigurationSchema.parse(input))
  .handler(async ({ context, data }) => {
    const { data: allowed, error: roleError } = await context.supabase.rpc("has_role", {
      _user_id: context.userId, _role: "super_admin",
    });
    if (roleError || !allowed) throw new Error("Only super administrators can edit club settings");
    const { error } = await context.supabase.rpc("save_club_configuration", { _value: data as Json });
    if (error) throw new Error(error.message);
    return { ok: true };
  });