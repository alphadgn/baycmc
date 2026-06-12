// @vitest-environment node
/**
 * LIVE on-chain integration test. Hits real Ethereum mainnet RPCs (no mocks)
 * to prove the verification path returns the actual on-chain state — i.e.
 * the agent isn't "hallucinating" a balance.
 *
 * Specifically verifies BAYC #2931's owner of record (queried directly via
 * `ownerOf(2931)` on the BAYC contract) is reported as a BAYC holder by
 * `walkOwnership`. The owner address is NOT hardcoded: we fetch it
 * on-the-fly so this test stays correct even if the token changes hands.
 *
 * Auto-skips when:
 *   - SKIP_LIVE_RPC=1 is set, or
 *   - the public RPC is unreachable (offline / CI without egress).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createPublicClient, http, fallback, getAddress, parseAbi } from "viem";
import { mainnet } from "viem/chains";
import { walkOwnership, BAYC, __resetOwnershipCachesForTests } from "@/server/ownership-walk";

const RPC_URLS = [
  process.env.ETH_RPC_URL,
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
  "https://rpc.ankr.com/eth",
  "https://cloudflare-eth.com",
].filter((u): u is string => Boolean(u));

const TOKEN_ID = 2931n;
const ownerOfAbi = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);

async function probe(): Promise<boolean> {
  for (const url of RPC_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
        signal: AbortSignal.timeout(4_000),
      });
      if (res.ok) return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

let reachable = false;
beforeAll(async () => {
  if (process.env.SKIP_LIVE_RPC === "1") return;
  reachable = await probe();
});

describe.runIf(process.env.SKIP_LIVE_RPC !== "1")(
  "live BAYC ownership verification (no mocks)",
  () => {
    it("reports the on-chain owner of BAYC #2931 as a verified BAYC holder", async () => {
      if (!reachable) {
        console.warn("[live test] skipping — no reachable Ethereum RPC");
        return;
      }
      __resetOwnershipCachesForTests();

      const client = createPublicClient({
        chain: mainnet,
        transport: fallback(
          RPC_URLS.map((u) => http(u, { timeout: 8_000, retryCount: 1 })),
        ),
      });

      // 1) Fetch the real owner of BAYC #2931 directly from the contract.
      const ownerRaw = (await client.readContract({
        address: BAYC,
        abi: ownerOfAbi,
        functionName: "ownerOf",
        args: [TOKEN_ID],
      })) as `0x${string}`;
      const owner = getAddress(ownerRaw) as `0x${string}`;
      expect(owner).toMatch(/^0x[0-9a-fA-F]{40}$/);

      // 2) Run the same walk verifyOwnership uses against that wallet.
      const result = await walkOwnership(client, { signer: owner });

      // 3) The walk MUST see at least the BAYC we just confirmed they own.
      expect(result.holdsApe).toBe(true);
      expect(result.basis).toBe("direct");
      expect(result.totalBayc).toBeGreaterThanOrEqual(1n);
    }, 30_000);
  },
);
