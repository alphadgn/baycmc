import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { mainnet } from "@reown/appkit/networks";
import { REOWN_PROJECT_ID } from "./constants";

const networks = [mainnet] as const;

export const wagmiAdapter = new WagmiAdapter({
  networks: [...networks],
  projectId: REOWN_PROJECT_ID,
  ssr: false,
});

let initialized = false;

export function initAppKit() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  createAppKit({
    adapters: [wagmiAdapter],
    networks: [...networks],
    projectId: REOWN_PROJECT_ID,
    metadata: {
      name: "BAYCMC",
      description: "Token-gated social platform for verified BAYC holders",
      url: window.location.origin,
      icons: [`${window.location.origin}/favicon.ico`],
    },
    features: {
      analytics: false,
      email: false,
      socials: false,
    },
    themeMode: "dark",
    themeVariables: {
      "--w3m-accent": "#D4AF37",
      "--w3m-border-radius-master": "2px",
    },
  });
}
