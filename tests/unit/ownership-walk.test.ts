// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  walkOwnership,
  balancesFor,
  resolveDelegatedVaults,
  __resetOwnershipCachesForTests,
  BAYC,
  MAYC,
  type OwnershipClient,
} from "@/server/ownership-walk";
import { DELEGATE_REGISTRY_V2 } from "@/lib/web3/constants";

// Helper addresses (checksummed). Lowercased inputs are also exercised in
// several cases to mirror the real Glyph payloads (Glyph hands us addresses
// in mixed case depending on the wallet's reporting convention).
const SIGNER = "0x1111111111111111111111111111111111111111" as const;
const VAULT = "0x2222222222222222222222222222222222222222" as const;
const LINKED_A = "0x3333333333333333333333333333333333333333" as const;
const LINKED_B = "0x4444444444444444444444444444444444444444" as const;
const LINKED_B_VAULT = "0x5555555555555555555555555555555555555555" as const;
const NO_RIGHTS = "0x0000000000000000000000000000000000000000000000000000000000000000";

type ReadCall = {
  address: string;
  functionName: string;
  args?: readonly unknown[];
};

/**
 * Build a deterministic mock client. The behaviour is keyed by
 * `${address.toLowerCase()}:${functionName}` (+ optional arg key for
 * balanceOf), so each test can declare exactly the on-chain responses it
 * needs without sequencing concerns.
 */
function makeClient(handlers: Record<string, unknown | (() => unknown)>) {
  const calls: ReadCall[] = [];
  const client: OwnershipClient = {
    // viem's readContract signature is wider than we need.
    readContract: (async (params: ReadCall) => {
      calls.push(params);
      const addr = (params.address ?? "").toString().toLowerCase();
      let key: string;
      if (params.functionName === "balanceOf") {
        const owner = (params.args?.[0] as string)?.toLowerCase();
        key = `${addr}:balanceOf:${owner}`;
      } else {
        const subject = (params.args?.[0] as string)?.toLowerCase();
        key = `${addr}:${params.functionName}:${subject ?? ""}`;
      }
      if (!(key in handlers)) {
        throw new Error(`mock client: no handler for ${key}`);
      }
      const v = handlers[key];
      return typeof v === "function" ? (v as () => unknown)() : v;
    }) as unknown as OwnershipClient["readContract"],
  };
  return { client, calls };
}

function bal(addr: string, bayc: bigint, mayc: bigint) {
  return {
    [`${BAYC.toLowerCase()}:balanceOf:${addr.toLowerCase()}`]: bayc,
    [`${MAYC.toLowerCase()}:balanceOf:${addr.toLowerCase()}`]: mayc,
  };
}

function delegations(signer: string, list: ReadonlyArray<Record<string, unknown>>) {
  return {
    [`${DELEGATE_REGISTRY_V2.toLowerCase()}:getIncomingDelegations:${signer.toLowerCase()}`]: list,
  };
}

describe("walkOwnership – verification of BAYC/MAYC holdings", () => {
  beforeEach(() => {
    __resetOwnershipCachesForTests();
  });

  it("verifies a direct BAYC holder on the signer wallet (no delegation needed)", async () => {
    const { client, calls } = makeClient({
      ...bal(SIGNER, 1n, 0n),
    });
    const result = await walkOwnership(client, { signer: SIGNER });
    expect(result.holdsApe).toBe(true);
    expect(result.basis).toBe("direct");
    expect(result.totalBayc).toBe(1n);
    expect(result.totalMayc).toBe(0n);
    expect(result.delegatedFrom).toBeNull();
    expect(result.linkedHolder).toBeNull();
    // Direct hit must short-circuit — no delegation lookup, no linked walks.
    expect(calls.some((c) => c.functionName === "getIncomingDelegations")).toBe(false);
  });

  it("verifies a direct MAYC-only holder", async () => {
    const { client } = makeClient({ ...bal(SIGNER, 0n, 5n) });
    const result = await walkOwnership(client, { signer: SIGNER });
    expect(result.holdsApe).toBe(true);
    expect(result.basis).toBe("direct");
    expect(result.totalMayc).toBe(5n);
  });

  it("verifies via delegate.cash when the signer holds nothing but a vault delegated BAYC to them", async () => {
    const { client } = makeClient({
      ...bal(SIGNER, 0n, 0n),
      ...bal(VAULT, 2n, 0n),
      ...delegations(SIGNER, [
        {
          type_: 3, // ERC721
          to: SIGNER,
          from: VAULT,
          rights: NO_RIGHTS,
          contract_: BAYC,
          tokenId: 0n,
          amount: 0n,
        },
      ]),
    });
    const result = await walkOwnership(client, { signer: SIGNER });
    expect(result.holdsApe).toBe(true);
    expect(result.basis).toBe("delegated");
    expect(result.delegatedFrom?.toLowerCase()).toBe(VAULT.toLowerCase());
    expect(result.vaultsChecked).toBe(1);
  });

  it("ignores delegations with custom rights (entry requires the no-rights default)", async () => {
    const SCOPED_RIGHTS = "0x736f6d655f7363696665645f72696768745f737472696e670000000000000000";
    const { client } = makeClient({
      ...bal(SIGNER, 0n, 0n),
      ...delegations(SIGNER, [
        {
          type_: 1, // ALL
          to: SIGNER,
          from: VAULT,
          rights: SCOPED_RIGHTS,
          contract_: "0x0000000000000000000000000000000000000000",
          tokenId: 0n,
          amount: 0n,
        },
      ]),
    });
    const result = await walkOwnership(client, { signer: SIGNER });
    expect(result.holdsApe).toBe(false);
    expect(result.vaultsChecked).toBe(0);
    expect(result.basis).toBe("direct");
  });

  it("ignores CONTRACT-scoped delegations for unrelated tokens", async () => {
    const RANDOM = "0x9999999999999999999999999999999999999999";
    const { client } = makeClient({
      ...bal(SIGNER, 0n, 0n),
      ...delegations(SIGNER, [
        {
          type_: 2, // CONTRACT
          to: SIGNER,
          from: VAULT,
          rights: NO_RIGHTS,
          contract_: RANDOM,
          tokenId: 0n,
          amount: 0n,
        },
      ]),
    });
    const result = await walkOwnership(client, { signer: SIGNER });
    expect(result.holdsApe).toBe(false);
    expect(result.vaultsChecked).toBe(0);
  });

  it("walks Glyph-linked wallets when signer + its delegations don't qualify", async () => {
    const { client } = makeClient({
      ...bal(SIGNER, 0n, 0n),
      ...bal(LINKED_A, 0n, 0n),
      ...bal(LINKED_B, 1n, 0n),
      ...delegations(SIGNER, []),
    });
    const result = await walkOwnership(client, {
      signer: SIGNER,
      linkedWallets: [LINKED_A, LINKED_B],
    });
    expect(result.holdsApe).toBe(true);
    expect(result.basis).toBe("linked");
    expect(result.linkedHolder?.toLowerCase()).toBe(LINKED_B.toLowerCase());
    expect(result.delegatedFrom).toBeNull();
    expect(result.linkedChecked).toBe(2);
  });

  it("walks delegations *into* a linked wallet too", async () => {
    const { client } = makeClient({
      ...bal(SIGNER, 0n, 0n),
      ...bal(LINKED_B, 0n, 0n),
      ...bal(LINKED_B_VAULT, 0n, 7n),
      ...delegations(SIGNER, []),
      ...delegations(LINKED_B, [
        {
          type_: 1, // ALL
          to: LINKED_B,
          from: LINKED_B_VAULT,
          rights: NO_RIGHTS,
          contract_: "0x0000000000000000000000000000000000000000",
          tokenId: 0n,
          amount: 0n,
        },
      ]),
    });
    const result = await walkOwnership(client, {
      signer: SIGNER,
      linkedWallets: [LINKED_B],
    });
    expect(result.holdsApe).toBe(true);
    expect(result.basis).toBe("linked");
    expect(result.linkedHolder?.toLowerCase()).toBe(LINKED_B.toLowerCase());
    expect(result.delegatedFrom?.toLowerCase()).toBe(LINKED_B_VAULT.toLowerCase());
    expect(result.totalMayc).toBe(7n);
  });

  it("dedupes the signer out of the linked list (and skips dupes / non-EVM strings)", async () => {
    const { client, calls } = makeClient({
      ...bal(SIGNER, 1n, 0n),
    });
    const result = await walkOwnership(client, {
      signer: SIGNER,
      linkedWallets: [
        SIGNER, // duplicate of signer — must be skipped
        SIGNER.toUpperCase(), // case-insensitive dupe
        "not-an-address",
        "0xnotreallyhex",
        LINKED_A,
        LINKED_A.toLowerCase(),
      ],
    });
    expect(result.holdsApe).toBe(true);
    expect(result.basis).toBe("direct");
    // Direct hit on signer short-circuits before we ever balance-check linked.
    expect(calls.filter((c) => c.functionName === "balanceOf").length).toBe(2);
  });

  it("returns not-verified with truthful telemetry when nothing qualifies anywhere", async () => {
    const { client } = makeClient({
      ...bal(SIGNER, 0n, 0n),
      ...bal(LINKED_A, 0n, 0n),
      ...delegations(SIGNER, []),
      ...delegations(LINKED_A, []),
    });
    const result = await walkOwnership(client, {
      signer: SIGNER,
      linkedWallets: [LINKED_A],
    });
    expect(result.holdsApe).toBe(false);
    expect(result.basis).toBe("direct");
    expect(result.linkedChecked).toBe(1);
    expect(result.totalBayc).toBe(0n);
    expect(result.totalMayc).toBe(0n);
  });

  it("treats a delegate.cash RPC failure as non-fatal — direct-only verdict still returns", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = makeClient({
      ...bal(SIGNER, 0n, 0n),
      [`${DELEGATE_REGISTRY_V2.toLowerCase()}:getIncomingDelegations:${SIGNER.toLowerCase()}`]:
        () => {
          throw new Error("registry RPC down");
        },
    });
    const result = await walkOwnership(client, { signer: SIGNER });
    expect(result.holdsApe).toBe(false);
    expect(result.vaultsChecked).toBe(0);
    errSpy.mockRestore();
  });

  it("propagates a signer balanceOf failure — caller must abort, not hallucinate a verdict", async () => {
    const { client } = makeClient({
      [`${BAYC.toLowerCase()}:balanceOf:${SIGNER.toLowerCase()}`]: () => {
        throw new Error("RPC eth_call failed");
      },
      [`${MAYC.toLowerCase()}:balanceOf:${SIGNER.toLowerCase()}`]: 0n,
    });
    await expect(walkOwnership(client, { signer: SIGNER })).rejects.toThrow(/RPC eth_call failed/);
  });
});

describe("balancesFor / resolveDelegatedVaults primitives", () => {
  beforeEach(() => {
    __resetOwnershipCachesForTests();
  });

  it("balancesFor caches positive balances for the TTL window (single RPC roundtrip per address)", async () => {
    const { client, calls } = makeClient({ ...bal(SIGNER, 3n, 4n) });
    const a = await balancesFor(client, SIGNER);
    const b = await balancesFor(client, SIGNER);
    expect(a).toEqual(b);
    expect(calls.filter((c) => c.functionName === "balanceOf").length).toBe(2);
  });

  it("resolveDelegatedVaults dedupes vaults that delegated both ALL and a contract-scoped right", async () => {
    const { client } = makeClient({
      ...delegations(SIGNER, [
        {
          type_: 1,
          to: SIGNER,
          from: VAULT,
          rights: NO_RIGHTS,
          contract_: "0x0000000000000000000000000000000000000000",
          tokenId: 0n,
          amount: 0n,
        },
        {
          type_: 3,
          to: SIGNER,
          from: VAULT,
          rights: NO_RIGHTS,
          contract_: BAYC,
          tokenId: 0n,
          amount: 0n,
        },
      ]),
    });
    const vaults = await resolveDelegatedVaults(client, SIGNER);
    expect(vaults).toHaveLength(1);
    expect(vaults[0].toLowerCase()).toBe(VAULT.toLowerCase());
  });
});
