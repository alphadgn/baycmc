// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { resolvePrivyEmbeddedWallet } from "@/lib/privyWallets";

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

type WalletLike = {
  address: string;
  type?: string;
  chainType?: string;
  walletClientType?: string;
  connectorType?: string;
};
type Hook = (args: {
  authenticated: boolean;
  walletsReady: boolean;
  wallets: WalletLike[];
  userWallet: WalletLike | null;
  linkedAccounts?: WalletLike[];
  userId: string | null;
  createWallet: () => Promise<WalletLike>;
}) => { state: string; createdWallet: WalletLike | null };

const useAutoProvision: Hook = ({
  authenticated,
  walletsReady,
  wallets,
  userWallet,
  linkedAccounts = [],
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

  const wallet = resolvePrivyEmbeddedWallet({
    user: { wallet: userWallet, linkedAccounts },
    wallets,
    createdWallet,
  }) as WalletLike | null;
  const hasKnownWallet = Boolean(wallet);

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
        userWallet: { address: "0xEXISTING", chainType: "ethereum", walletClientType: "privy" },
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
        wallets: [{ address: "0xCONNECTED", chainType: "ethereum", walletClientType: "privy" }],
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

  it("waits for walletsReady to become true before creating a missing wallet", async () => {
    const { result, rerender } = renderHook(
      (props: Parameters<Hook>[0]) => useAutoProvision(props),
      {
        initialProps: {
          authenticated: true,
          walletsReady: false,
          wallets: [],
          userWallet: null,
          userId: "did:privy:user-ready-toggle",
          createWallet,
        },
      },
    );

    await new Promise((r) => setTimeout(r, 10));
    expect(createWallet).not.toHaveBeenCalled();

    rerender({
      authenticated: true,
      walletsReady: true,
      wallets: [],
      userWallet: null,
      userId: "did:privy:user-ready-toggle",
      createWallet,
    });

    await waitFor(() => expect(result.current.state).toBe("created"));
    expect(createWallet).toHaveBeenCalledTimes(1);
  });

  it("does not create when walletsReady toggles true with an existing linked embedded wallet", async () => {
    const { rerender } = renderHook((props: Parameters<Hook>[0]) => useAutoProvision(props), {
      initialProps: {
        authenticated: true,
        walletsReady: false,
        wallets: [],
        userWallet: { address: "0xEXISTING", chainType: "ethereum", walletClientType: "privy" },
        userId: "did:privy:user-existing-toggle",
        createWallet,
      },
    });

    rerender({
      authenticated: true,
      walletsReady: true,
      wallets: [],
      userWallet: { address: "0xEXISTING", chainType: "ethereum", walletClientType: "privy" },
      userId: "did:privy:user-existing-toggle",
      createWallet,
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(createWallet).not.toHaveBeenCalled();
  });

  it("prioritizes linked embedded wallets over connected and newly created wallets", () => {
    const wallet = resolvePrivyEmbeddedWallet({
      user: {
        wallet: { address: "0xUSER", chainType: "ethereum", walletClientType: "privy" },
        linkedAccounts: [
          { type: "wallet", address: "0xLINKED", chainType: "ethereum", walletClientType: "privy" },
        ],
      },
      wallets: [{ address: "0xCONNECTED", chainType: "ethereum", walletClientType: "privy" }],
      createdWallet: { address: "0xCREATED" },
    });

    expect(wallet?.address).toBe("0xLINKED");
  });

  it("ignores external user.wallet entries so email users still get an embedded wallet", async () => {
    const { result } = renderHook(() =>
      useAutoProvision({
        authenticated: true,
        walletsReady: true,
        wallets: [],
        userWallet: { address: "0xMETAMASK" },
        userId: "did:privy:user-external-wallet",
        createWallet,
      }),
    );

    await waitFor(() => expect(result.current.state).toBe("created"));
    expect(createWallet).toHaveBeenCalledTimes(1);
  });

  it("re-resolves to a newly linked embedded wallet when it appears across rerenders", async () => {
    const { result, rerender } = renderHook(
      (props: {
        userWallet: WalletLike | null;
        wallets: WalletLike[];
        createdWallet: WalletLike | null;
      }) =>
        resolvePrivyEmbeddedWallet({
          user: { wallet: props.userWallet, linkedAccounts: [] },
          wallets: props.wallets,
          createdWallet: props.createdWallet,
        }),
      {
        initialProps: {
          userWallet: null,
          wallets: [],
          createdWallet: { address: "0xCREATED" } as WalletLike,
        },
      },
    );
    expect(result.current?.address).toBe("0xCREATED");

    // Privy then surfaces an embedded wallet through useWallets()
    rerender({
      userWallet: null,
      wallets: [{ address: "0xCONNECTED", chainType: "ethereum", walletClientType: "privy" }],
      createdWallet: { address: "0xCREATED" },
    });
    expect(result.current?.address).toBe("0xCONNECTED");

    // Then the user.wallet field gets populated with an embedded wallet
    rerender({
      userWallet: { address: "0xUSER", chainType: "ethereum", walletClientType: "privy" },
      wallets: [{ address: "0xCONNECTED", chainType: "ethereum", walletClientType: "privy" }],
      createdWallet: { address: "0xCREATED" },
    });
    expect(result.current?.address).toBe("0xUSER");
  });

  it("falls back to createdWallet only when no other embedded source exists", () => {
    expect(
      resolvePrivyEmbeddedWallet({
        user: { wallet: null, linkedAccounts: [] },
        wallets: [],
        createdWallet: { address: "0xCREATED" },
      })?.address,
    ).toBe("0xCREATED");
    expect(
      resolvePrivyEmbeddedWallet({
        user: { wallet: null, linkedAccounts: [] },
        wallets: [],
        createdWallet: null,
      }),
    ).toBeNull();
  });
});
