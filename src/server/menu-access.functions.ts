import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MENU_ITEM_KEYS } from "@/lib/baycmc/menu-items";
import { COLLECTION_REGISTRY } from "@/lib/web3/constants";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function requireSuperAdmin(userId: string) {
  const db = await admin();
  const { data } = await db.from("user_roles").select("role").eq("user_id", userId);
  if (!data?.some((r) => r.role === "super_admin")) throw new Error("Forbidden: super admin only");
  return db;
}

/** The full collection × menu-item matrix (super admin check sheet). */
export const getMenuMatrix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await requireSuperAdmin(context.userId);
    const { data, error } = await db
      .from("collection_menu_items")
      .select("collection_label,item_key,enabled,updated_at");
    if (error) throw new Error(error.message);
    const collections = COLLECTION_REGISTRY.filter((c) => c.active).map((c) => ({
      label: c.label as string,
      name: c.name as string,
      access: c.access as string,
    }));
    return { collections, rows: data ?? [] };
  });

export const setMenuItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { collection: string; item: string; enabled: boolean }) =>
    z
      .object({
        collection: z.string().regex(/^[A-Z0-9_]{2,40}$/),
        item: z.enum(MENU_ITEM_KEYS as [string, ...string[]]),
        enabled: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await requireSuperAdmin(context.userId);
    const known = COLLECTION_REGISTRY.find((c) => c.label === data.collection && c.active);
    if (!known) throw new Error("Unknown collection");
    const { error } = await db.from("collection_menu_items").upsert(
      {
        collection_label: data.collection,
        item_key: data.item,
        enabled: data.enabled,
        updated_at: new Date().toISOString(),
        updated_by: context.userId,
      },
      { onConflict: "collection_label,item_key" },
    );
    if (error) throw new Error(error.message);
    await db.from("audit_logs").insert({
      event_type: "menu_access.update",
      actor_id: context.userId,
      metadata: { collection: data.collection, item: data.item, enabled: data.enabled },
    });
    return { ok: true };
  });
