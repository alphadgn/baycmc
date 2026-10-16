import { useMemo, useState } from "react";
import { RelayKitProvider, SwapWidget } from "@relayprotocol/relay-kit-ui";
import {
  adaptViemWallet,
  convertViemChainToRelayChain,
  MAINNET_RELAY_API,
} from "@relayprotocol/relay-sdk";
import { apeChain, arbitrum, base, mainnet, optimism, polygon } from "viem/chains";
import { useConnect, useWalletClient } from "wagmi";
import { toast } from "sonner";
// Relay's stylesheet is scoped to `.relay-kit-reset` and lives in CSS
// layers, so (unlike Glyph's) it cannot restyle the rest of the site.
import "@relayprotocol/relay-kit-ui/styles.css";
import { GLYPH_CONNECTOR_ID } from "@/components/GlyphAppProvider";

const CHAINS = [mainnet, apeChain, base, arbitrum, optimism, polygon].map((c) =>
  convertViemChainToRelayChain(c),
);

const NATIVE = "0x0000000000000000000000000000000000000000";

type Token = {
  chainId: number;
  address: string;
  decimals: number;
  name: string;
  symbol: string;
  logoURI: string;
};

const ETH: Token = {
  chainId: mainnet.id,
  address: NATIVE,
  decimals: 18,
  name: "Ether",
  symbol: "ETH",
  logoURI: "https://assets.relay.link/icons/currencies/eth.png",
};
const APE: Token = {
  chainId: apeChain.id,
  address: NATIVE,
  decimals: 18,
  name: "ApeCoin",
  symbol: "APE",
  logoURI: "https://assets.relay.link/icons/currencies/ape.png",
};

/**
 * Relay (relay.link) swap & bridge, live in the page: quotes stream from
 * Relay's API and the swap executes from the member's own wallet.
 * Defaults to ETH (Ethereum) → APE (ApeChain).
 */
export default function RelaySwapPanel() {
  const { data: walletClient } = useWalletClient();
  const { connectors, connectAsync } = useConnect();
  const [fromToken, setFromToken] = useState<Token | undefined>(ETH);
  const [toToken, setToToken] = useState<Token | undefined>(APE);

  const wallet = useMemo(
    () => (walletClient ? adaptViemWallet(walletClient) : undefined),
    [walletClient],
  );

  async function connect() {
    const hasInjected =
      typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum;
    const c =
      (hasInjected
        ? connectors.find((x) => x.type === "injected" && x.id !== GLYPH_CONNECTOR_ID)
        : undefined) ??
      connectors.find((x) => x.id === GLYPH_CONNECTOR_ID) ??
      connectors[0];
    if (!c) return void toast.error("No wallet available to connect.");
    try {
      await connectAsync({ connector: c });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg && !/rejected|denied|closed|cancel/i.test(msg)) toast.error(msg);
    }
  }

  return (
    <RelayKitProvider
      options={{
        appName: "BAYCmc",
        chains: CHAINS,
        baseApiUrl: MAINNET_RELAY_API,
        themeScheme: "dark",
        acknowledgeApiKeyExposure: true,
      }}
      theme={{
        primaryColor: "#F5B100",
        focusColor: "#F5B100",
        subtleBackgroundColor: "#121010",
        subtleBorderColor: "rgba(245,177,0,0.25)",
        text: { default: "#F4EFE6", subtle: "#A39C90" },
        buttons: {
          primary: { color: "#140F05", background: "#F5B100", hover: { background: "#FFC933" } },
        },
        input: { background: "#0B0908", color: "#F4EFE6" },
        widget: {
          background: "transparent",
          border: "none",
          boxShadow: "none",
          card: { background: "#0F0C0A", border: "1px solid rgba(245,177,0,0.2)" },
        },
        modal: { background: "#0F0C0A", border: "1px solid rgba(245,177,0,0.35)" },
        dropdown: { background: "#0F0C0A", border: "1px solid rgba(245,177,0,0.25)" },
      }}
    >
      <SwapWidget
        supportedWalletVMs={["evm"]}
        wallet={wallet}
        fromToken={fromToken}
        setFromToken={(t) => setFromToken(t as Token | undefined)}
        toToken={toToken}
        setToToken={(t) => setToToken(t as Token | undefined)}
        popularChainIds={[mainnet.id, apeChain.id, base.id, arbitrum.id]}
        disableInputAutoFocus
        onConnectWallet={() => void connect()}
        onSwapSuccess={() => toast.success("Swap complete")}
        onSwapError={(e) => {
          if (e && !/rejected|denied/i.test(String(e))) toast.error(String(e));
        }}
      />
    </RelayKitProvider>
  );
}
