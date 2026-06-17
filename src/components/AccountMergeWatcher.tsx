import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { findAccountCollision } from "@/server/account-merge.functions";

/**
 * Watches for sign-in events and, when the freshly signed-in account
 * collides with an existing OTHER account (same email or wallet), routes
 * the user to /account-merge before they can reach the app. The collision
 * server fn returns null once a permanent decision has been recorded for
 * the pair, so this is a one-shot prompt.
 *
 * `useServerFn` returns a NEW function reference on every render. Keeping it
 * in the effect dependency array tore down and re-armed the auth listener on
 * every parent render, which on iOS Safari produced a flood of
 * `findAccountCollision` RPCs surfacing as `TypeError: Load failed`. We stash
 * it in a ref so the effect runs exactly once per mount.
 */
export function AccountMergeWatcher() {
  const router = useRouter();
  const findFn = useServerFn(findAccountCollision);
  const findFnRef = useRef(findFn);
  findFnRef.current = findFn;
  const checkedForUserRef = useRef<string | null>(null);

  const check = useCallback(
    async (userId: string) => {
      if (checkedForUserRef.current === userId) return;
      checkedForUserRef.current = userId;
      try {
        const collision = await findFnRef.current();
        if (!collision) return;
        const path = router.state.location.pathname;
        if (path === "/account-merge") return;
        void router.navigate({ to: "/account-merge", replace: true });
      } catch (e) {
        console.warn("[AccountMergeWatcher]", e);
      }
    },
    [router],
  );

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user?.id) void check(data.session.user.id);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        checkedForUserRef.current = null;
        return;
      }
      if ((event === "SIGNED_IN" || event === "USER_UPDATED") && session?.user?.id) {
        void check(session.user.id);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [check]);

  return null;
}
