import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Options {
  userId: string | null | undefined;
  /** Called when wallet/verification/role state may have changed. Debounced. */
  onRevalidate: () => void | Promise<void>;
  /** Debounce window in ms. Default 250. */
  debounceMs?: number;
  /** Also revalidate on `room_bookings` / `rooms` table changes. */
  watchRooms?: boolean;
}

/**
 * Centralised revalidation hook. Subscribes once to:
 *  - Supabase realtime changes on `user_verifications` and `user_roles`
 *    (scoped to the current user when known), and optionally `rooms` /
 *    `room_bookings`.
 *  - Supabase auth state changes (sign-in/out, token refresh, account
 *    switch).
 *  - Browser events fired by the Privy / wallet bridge:
 *    `baycmc:verification-refreshed`, `baycmc:verification-refresh`,
 *    `baycmc:wallet-changed`.
 *  - Tab visibility changes (re-check when the user returns).
 *
 * All triggers are debounced so a burst of events (e.g. realtime + wallet
 * event) only fires one revalidation.
 */
export function useVerificationRevalidation({
  userId,
  onRevalidate,
  debounceMs = 250,
  watchRooms = false,
}: Options) {
  const cbRef = useRef(onRevalidate);
  cbRef.current = onRevalidate;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void cbRef.current();
      }, debounceMs);
    };

    const channel = supabase.channel(`verification-revalidate-${userId ?? "anon"}`);
    channel.on(
      "postgres_changes",
      userId
        ? { event: "*", schema: "public", table: "user_verifications", filter: `user_id=eq.${userId}` }
        : { event: "*", schema: "public", table: "user_verifications" },
      fire,
    );
    channel.on(
      "postgres_changes",
      userId
        ? { event: "*", schema: "public", table: "user_roles", filter: `user_id=eq.${userId}` }
        : { event: "*", schema: "public", table: "user_roles" },
      fire,
    );
    if (watchRooms) {
      channel.on("postgres_changes", { event: "*", schema: "public", table: "rooms" }, fire);
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_bookings" },
        fire,
      );
    }
    channel.subscribe();

    const { data: authSub } = supabase.auth.onAuthStateChange(() => fire());

    const onWindow = () => fire();
    window.addEventListener("baycmc:verification-refreshed", onWindow);
    window.addEventListener("baycmc:verification-refresh", onWindow);
    window.addEventListener("baycmc:wallet-changed", onWindow);
    const onVisible = () => {
      if (document.visibilityState === "visible") fire();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
      authSub.subscription.unsubscribe();
      window.removeEventListener("baycmc:verification-refreshed", onWindow);
      window.removeEventListener("baycmc:verification-refresh", onWindow);
      window.removeEventListener("baycmc:wallet-changed", onWindow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId, debounceMs, watchRooms]);
}
