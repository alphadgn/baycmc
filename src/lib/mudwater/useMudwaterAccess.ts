import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";

/**
 * Whether the signed-in member may see Mudwater at all: only sessions
 * signed in with a blockchain wallet (server-decided via
 * my_mudwater_access). Re-checked when the session or wallets change.
 */
export function useMudwaterAccess(): boolean {
  const { user } = useAuth();
  const [ok, setOk] = useState(false);
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) {
      setOk(false);
      return;
    }
    let cancelled = false;
    const load = () => {
      void supabase.rpc("my_mudwater_access").then(({ data }) => {
        if (!cancelled) setOk(data === true);
      });
    };
    load();
    window.addEventListener("baycmc:verification-refresh", load);
    window.addEventListener("baycmc:linked-wallets-changed", load);
    return () => {
      cancelled = true;
      window.removeEventListener("baycmc:verification-refresh", load);
      window.removeEventListener("baycmc:linked-wallets-changed", load);
    };
  }, [userId]);
  return ok;
}
