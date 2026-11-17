import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseClubConfiguration } from "@/lib/club-configuration";

export async function readClubConfiguration() {
  const { data, error } = await supabaseAdmin.rpc("club_configuration");
  if (error) throw new Error(error.message);
  return parseClubConfiguration(data);
}
export async function activeCollections() {
  return (await readClubConfiguration()).collections.filter((c) => c.active);
}