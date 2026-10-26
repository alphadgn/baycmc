import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";
import { areaForPath } from "@/lib/baycmc/menu-items";
import { collectionNameForLabel } from "@/lib/web3/constants";

/**
 * Sale detection while the app is open.
 *
 * About once a minute the server re-checks the wallets proven in this
 * sign-in session — for LOSSES only (a sale, transfer or withdrawn
 * delegation that leaves no NFT of a collection). Nothing is ever added
 * mid-session; a new NFT counts from the next sign-in.
 *
 * When a collection is lost the member is told, and:
 *   - live video rooms, Holders Chat and every other collection-opened
 *     area: removed straight away (back to the lobby);
 *   - Mudwater: a game in progress finishes normally, then access ends
 *     (enforced by the server — this watcher doesn't interrupt the game).
 * Admins and verified-role members aren't affected while they hold the role.
 */
const CHECK_EVERY_MS = 60_000;

export function AccessLossWatcher() {
  const { user } = useAuth();
  const v = useVerificationStatus();
  const navigate = useNavigate();
  const location = useLocation();
  const prevRef = useRef<{ userId: string; labels: Set<string>; lifer: boolean } | null>(null);
  const refreshRef = useRef(v.refresh);
  refreshRef.current = v.refresh;
  const userId = user?.id ?? null;

  // Periodic loss check.
  useEffect(() => {
    if (!userId) return;
    const id = setInterval(() => {
      void refreshRef.current().catch(() => undefined);
    }, CHECK_EVERY_MS);
    return () => clearInterval(id);
  }, [userId]);

  // React to a change in what this session holds.
  useEffect(() => {
    if (!userId || v.loading) return;
    const labels = new Set(v.collections);
    const prev = prevRef.current;
    prevRef.current = { userId, labels, lifer: v.isLifer };
    if (!prev || prev.userId !== userId) return;
    const lost = [...prev.labels].filter((l) => !labels.has(l));
    const lostLifer = prev.lifer && !v.isLifer;
    if (lost.length === 0 && !lostLifer) return;
    const roleProtected = v.isAdmin || v.roles.includes("verified_user");

    if (lost.length > 0) {
      const names = lost.map((l) => collectionNameForLabel(l) ?? l).join(", ");
      toast.warning(`You no longer qualify as a ${names} holder.`, {
        description: roleProtected
          ? "Your role keeps your current access."
          : "Areas opened by that collection are closed for the rest of this session. A Mudwater game already in progress can be finished.",
        duration: 12_000,
      });
    }
    if (roleProtected) return;

    void (async () => {
      const path = location.pathname;
      if (path.startsWith("/lifers") && !v.isLifer) {
        void navigate({ to: "/lobby", replace: true });
        return;
      }
      const area = areaForPath(path);
      if (!area) return;
      const { data: allowed } = await supabase.rpc("my_menu_items");
      if (!((allowed as string[] | null) ?? []).includes(area)) {
        void navigate({ to: "/lobby", replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, v.loading, v.collections.join(","), v.isLifer]);

  return null;
}
