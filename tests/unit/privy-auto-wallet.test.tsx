import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";

/**
 * These tests pin down the rule the user asked us to enforce:
 *   - Privy MUST auto-create an embedded EVM wallet when, and ONLY when,
 *     the authenticated user has no wallet linked yet.
 *   - It MUST NOT create a second wallet on rapid re-renders, concurrent
 *     effects, or repeated sign-ins of the same Privy user id.
 *
 * We extract the auto-provision logic from PrivyVerifyCard into a hook
 * shape and exercise the same state machine the component uses.
 */

type WalletLike = { address: string };
type Hook = (args: {
  authenticated: boolean;
  walletsReady: boolean;
  wallets: WalletLike[];
  userWallet: WalletLike | null;
  userId: string | null;
  createWallet: () => Promise<WalletLike>;
}) => { state: string; createdWallet: WalletLike | null };

const useAutoProvision: Hook = ({
  authenticated,
  walletsReady,
  wallets,
  userWallet,
  userId,
  createWallet,
}) => {
  const [state, setState] = useState<"idle" | "creating" | "created" | "failed">("idle");
  const [createdWallet, setCreatedWallet] = useState<WalletLike | null>(null);
  const startedRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    const cur = authenticated ? userId : null;
    if (lastUserIdRef.current !== cur) {
      lastUserIdRef.current = cur;
      startedRef.current = false;
      if (!authenticated) {
        setCreatedWallet(null);
        setState("idle");
      }
    }
  }, [authenticated, userId]);

  const wallet = wallets[0] ?? createdWallet ?? userWallet;
  const hasKnownWallet = Boolean(wallets.length > 0 || createdWallet || userWallet);

  useEffect(() => {
    if (
      !authenticated ||
      !walletsReady ||
      wallet ||
      hasKnownWallet ||
      state !== "idle" ||
      startedRef.current ||
      !userId
    ) {
      return;
    }
    startedRef.current = true;
    setState("creating");
    void createWallet()
      .then((w) => {
        setCreatedWallet(w);
        setState("created");
      })
      .catch(() => setState("failed"));
  }, [authenticated, walletsReady, wallet, hasKnownWallet, state, userId, createWallet]);

  return { state, createdWallet };
};

describe("Privy embedded wallet auto-provisioning", () => {
  let createWallet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createWallet = vi.fn(async () => ({ address: "0xNEW" }));
  });

  it("creates a wallet when authenticated user has no linked wallet", async () => {
    const { result } = renderHook(() =>
      useAutoProvision({
        authenticated: true,
        walletsReady: true,
        wallets: [],
        userWallet: null,
        userId: "did:privy:user-1",
        createWallet,
      }),
    );
    await waitFor(() => expect(result.current.state).toBe("created"));
    expect(createWallet).toHaveBeenCalledTimes(1);
    expect(result.current.createdWallet?.address).toBe("0xNEW");
  });

  it("does NOT create a wallet when one is already linked to the user", async () => {
    renderHook(() =>
      useAutoProvision({
        authenticated: true,
        walletsReady: true,
        wallets: [],
        userWallet: { address: "0xEXISTING" },
        userId: "did:privy:user-2",
        createWallet,
      }),
    );
    // Give effects a tick to flush
    await new Promise((r) => setTimeout(r, 10));
    expect(createWallet).not.toHaveBeenCalled();
  });

  it("does NOT create a wallet when wallets[] already has an entry", async () => {
    renderHook(() =>
      useAutoProvision({
        authenticated: true,
        walletsReady: true,
        wallets: [{ address: "0xCONNECTED" }],
        userWallet: null,
        userId: "did:privy:user-3",
        createWallet,
      }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(createWallet).not.toHaveBeenCalled();
  });

  it("only calls createWallet once across rapid re-renders for the same user", async () => {
    const { result, rerender } = renderHook(
      (props: Parameters<Hook>[0]) => useAutoProvision(props),
      {
        initialProps: {
          authenticated: true,
          walletsReady: true,
          wallets: [],
          userWallet: null,
          userId: "did:privy:user-4",
          createWallet,
        },
      },
    );
    // Simulate concurrent renders
    for (let i = 0; i < 5; i++) {
      rerender({
        authenticated: true,
        walletsReady: true,
        wallets: [],
        userWallet: null,
        userId: "did:privy:user-4",
        createWallet,
      });
    }
    await waitFor(() => expect(result.current.state).toBe("created"));
    expect(createWallet).toHaveBeenCalledTimes(1);
  });

  it("re-evaluates after logout + new sign-in with a new user id", async () => {
    const { result, rerender } = renderHook(
      (props: Parameters<Hook>[0]) => useAutoProvision(props),
      {
        initialProps: {
          authenticated: true,
          walletsReady: true,
          wallets: [],
          userWallet: null,
          userId: "did:privy:user-A",
          createWallet,
        },
      },
    );
    await waitFor(() => expect(result.current.state).toBe("created"));
    expect(createWallet).toHaveBeenCalledTimes(1);

    // Logout
    act(() => {
      rerender({
        authenticated: false,
        walletsReady: true,
        wallets: [],
        userWallet: null,
        userId: null,
        createWallet,
      });
    });

    // New user signs in
    act(() => {
      rerender({
        authenticated: true,
        walletsReady: true,
        wallets: [],
        userWallet: null,
        userId: "did:privy:user-B",
        createWallet,
      });
    });

    await waitFor(() => expect(createWallet).toHaveBeenCalledTimes(2));
  });
});
