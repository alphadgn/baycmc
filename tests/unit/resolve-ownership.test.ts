// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { PublicClient } from "viem";
import { scanCollections } from "@/server/ownership/collectionScanner";
import { resolveDelegations } from "@/server/ownership/delegateResolver";
import { collectionLabel, BAYC_CONTRACT, MAYC_CONTRACT, REQUIRED_COLLECTIONS } from "@/server/ownership/collections";

const SIGNER = "0x1111111111111111111111111111111111111111" as const;
const LINKED = "0x2222222222222222222222222222222222222222" as const;
const VAULT = "0x3333333333333333333333333333333333333333" as const;
const DELEGATE_OUT = "0x4444444444444444444444444444444444444444" as const;
const NO_RIGHTS = "0x0000000000000000000000000000000000000000000000000000000000000000";

type ReadParams = { address: string; functionName: string; args?: readonly unknown[] };

function mockClient(handler: (p: ReadParams) => unknown): PublicClient {
  return {
    readContract: async (p: ReadParams) => handler(p),
    // viem PublicClient has more methods we don't use here
  } as unknown as PublicClient;
}

// ---- Engine primitives ----

describe("collectionLabel", () => {
  it("maps BAYC and MAYC addresses regardless of case", () => {
    expect(collectionLabel(BAYC_CONTRACT)).toBe("BAYC");
    expect(collectionLabel(BAYC_CONTRACT.toLowerCase())).toBe("BAYC");
    expect(collectionLabel(MAYC_CONTRACT)).toBe("MAYC");
    expect(collectionLabel("0xdead000000000000000000000000000000000000")).toBe(null);
  });
});

describe("scanCollections (8 acceptance scenarios)", () => {
  function balanceHandler(balances: Record<string, Record<string, bigint>>) {
    return ({ address, functionName, args }: ReadParams) => {
      if (functionName !== "balanceOf") throw new Error("unexpected fn");
      const owner = (args![0] as string).toLowerCase();
      return balances[owner]?.[(address as string).toLowerCase()] ?? 0n;
    };
  }

  // Use a fresh block per test so the 60s cache never crosses scenarios.
  let block = 1_000_000n;
  const next = () => ++block;

  it("1. Connected wallet owns BAYC → PASS", async () => {
    const c = mockClient(
      balanceHandler({ [SIGNER]: { [BAYC_CONTRACT.toLowerCase()]: 1n } }),
    );
    const r = await scanCollections(c, [SIGNER], REQUIRED_COLLECTIONS, next());
    expect(r).toEqual([{ wallet: SIGNER, contract: BAYC_CONTRACT, balance: 1 }]);
  });

  it("2. Connected wallet owns MAYC → PASS", async () => {
    const c = mockClient(
      balanceHandler({ [SIGNER]: { [MAYC_CONTRACT.toLowerCase()]: 3n } }),
    );
    const r = await scanCollections(c, [SIGNER], REQUIRED_COLLECTIONS, next());
    expect(r).toEqual([{ wallet: SIGNER, contract: MAYC_CONTRACT, balance: 3 }]);
  });

  it("3. Delegate vault owns BAYC → PASS (when vault is in the scan set)", async () => {
    const c = mockClient(
      balanceHandler({ [VAULT]: { [BAYC_CONTRACT.toLowerCase()]: 2n } }),
    );
    const r = await scanCollections(c, [SIGNER, VAULT], REQUIRED_COLLECTIONS, next());
    expect(r).toContainEqual({ wallet: VAULT, contract: BAYC_CONTRACT, balance: 2 });
  });

  it("4. Vault owns MAYC → PASS", async () => {
    const c = mockClient(
      balanceHandler({ [VAULT]: { [MAYC_CONTRACT.toLowerCase()]: 5n } }),
    );
    const r = await scanCollections(c, [SIGNER, VAULT], REQUIRED_COLLECTIONS, next());
    expect(r.find((o) => o.contract === MAYC_CONTRACT)?.balance).toBe(5);
  });

  it("5. No ownership across the graph → DENY", async () => {
    const c = mockClient(balanceHandler({}));
    const r = await scanCollections(c, [SIGNER, LINKED, VAULT], REQUIRED_COLLECTIONS, next());
    expect(r).toEqual([]);
  });

  it("6. Multiple wallets connected → PASS if any qualify", async () => {
    const c = mockClient(
      balanceHandler({
        [SIGNER]: { [BAYC_CONTRACT.toLowerCase()]: 0n },
        [LINKED]: { [BAYC_CONTRACT.toLowerCase()]: 1n },
      }),
    );
    const r = await scanCollections(c, [SIGNER, LINKED], REQUIRED_COLLECTIONS, next());
    expect(r).toEqual([{ wallet: LINKED, contract: BAYC_CONTRACT, balance: 1 }]);
  });

  it("7. Repeat scan within TTL is served from cache (no extra RPC)", async () => {
    let rpcCalls = 0;
    const c = mockClient((p) => {
      rpcCalls++;
      const balances: Record<string, bigint> = { [BAYC_CONTRACT.toLowerCase()]: 1n };
      return balances[(p.address as string).toLowerCase()] ?? 0n;
    });
    const sameBlock = next();
    await scanCollections(c, [SIGNER], REQUIRED_COLLECTIONS, sameBlock);
    const before = rpcCalls;
    await scanCollections(c, [SIGNER], REQUIRED_COLLECTIONS, sameBlock);
    expect(rpcCalls).toBe(before); // every call cached
  });

  it("8. balanceOf failure on one wallet does not deny the others", async () => {
    const c = mockClient((p) => {
      const owner = (p.args![0] as string).toLowerCase();
      if (owner === SIGNER.toLowerCase()) throw new Error("rpc-down");
      if (owner === LINKED.toLowerCase() && (p.address as string).toLowerCase() === BAYC_CONTRACT.toLowerCase()) {
        return 1n;
      }
      return 0n;
    });
    const r = await scanCollections(c, [SIGNER, LINKED], REQUIRED_COLLECTIONS, next());
    expect(r).toEqual([{ wallet: LINKED, contract: BAYC_CONTRACT, balance: 1 }]);
  });
});

describe("resolveDelegations (incoming + outgoing walk)", () => {
  it("returns vaults from incoming and delegates from outgoing", async () => {
    const client = mockClient((p) => {
      if (p.functionName === "getIncomingDelegations") {
        return [
          {
            type_: 1,
            to: SIGNER,
            from: VAULT,
            rights: NO_RIGHTS,
            contract_: "0x0000000000000000000000000000000000000000",
            tokenId: 0n,
            amount: 0n,
          },
        ];
      }
      if (p.functionName === "getOutgoingDelegations") {
        return [
          {
            type_: 2,
            to: DELEGATE_OUT,
            from: SIGNER,
            rights: NO_RIGHTS,
            contract_: BAYC_CONTRACT,
            tokenId: 0n,
            amount: 0n,
          },
        ];
      }
      return [];
    });
    const r = await resolveDelegations(client, SIGNER);
    expect(r.incomingVaults.map((a) => a.toLowerCase())).toContain(VAULT.toLowerCase());
    expect(r.outgoingDelegates.map((a) => a.toLowerCase())).toContain(DELEGATE_OUT.toLowerCase());
  });

  it("ignores delegations with non-empty rights or wrong contract", async () => {
    const client = mockClient((p) => {
      if (p.functionName === "getIncomingDelegations") {
        return [
          {
            type_: 2,
            to: SIGNER,
            from: VAULT,
            rights:
              "0x1111111111111111111111111111111111111111111111111111111111111111",
            contract_: BAYC_CONTRACT,
            tokenId: 0n,
            amount: 0n,
          },
          {
            type_: 2,
            to: SIGNER,
            from: VAULT,
            rights: NO_RIGHTS,
            contract_: "0xdead000000000000000000000000000000000000",
            tokenId: 0n,
            amount: 0n,
          },
        ];
      }
      return [];
    });
    const r = await resolveDelegations(client, SIGNER);
    expect(r.incomingVaults).toEqual([]);
  });
});
