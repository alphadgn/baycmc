import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";
import type { MenuItemKey } from "@/lib/baycmc/menu-items";

/**
 * Gated menu areas this account may open, decided in the database from the
 * super admin's per-collection matrix (my_menu_items()). Re-read whenever the
 * verified collections change.
 */
export function useMenuItems(): Set<MenuItemKey> {
  const { user } = useAuth();
  const { collections } = useVerificationStatus();
  const [items, setItems] = useState<Set<MenuItemKey>>(new Set());
  const key = `${user?.id ?? ""}|${collections.join(",")}`;
  useEffect(() => {
    if (!user) {
      setItems(new Set());
      return;
    }
    let cancelled = false;
    const load = () =>
      void supabase.rpc("my_menu_items").then(({ data }) => {
        if (!cancelled) setItems(new Set((data ?? []) as MenuItemKey[]));
      });
    load();
    window.addEventListener("baycmc:verification-refresh", load);
    window.addEventListener("baycmc:menu-access-changed", load);
    return () => {
      cancelled = true;
      window.removeEventListener("baycmc:verification-refresh", load);
      window.removeEventListener("baycmc:menu-access-changed", load);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return items;
}
