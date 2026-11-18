import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getAccessibleMenuItems } from "@/server/menu-access.functions";
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
  const fetchItems = useServerFn(getAccessibleMenuItems);
  const [snapshot, setSnapshot] = useState<{ key: string; items: Set<MenuItemKey> } | null>(null);
  const key = `${user?.id ?? ""}|${collections.join(",")}`;
  useEffect(() => {
    if (!user) {
      setSnapshot(null);
      return;
    }
    let cancelled = false;
    const load = () =>
      void fetchItems()
        .then((data) => {
          if (!cancelled) setSnapshot({ key, items: new Set(data) });
        })
        .catch(() => {
          if (!cancelled) setSnapshot({ key, items: new Set() });
        });
    load();
    const timer = window.setInterval(load, 15_000);
    window.addEventListener("baycmc:verification-refresh", load);
    window.addEventListener("baycmc:menu-access-changed", load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("baycmc:verification-refresh", load);
      window.removeEventListener("baycmc:menu-access-changed", load);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fetchItems]);
  return snapshot?.key === key ? snapshot.items : new Set();
}
