export type PrivyWalletLike = {
  address?: string;
  type?: string;
  chainType?: string;
  chain_type?: string;
  walletClientType?: string;
  wallet_client_type?: string;
  connectorType?: string;
  connector_type?: string;
};

export type PrivyUserWalletLike = {
  wallet?: PrivyWalletLike | null;
  linkedAccounts?: PrivyWalletLike[];
};

export function isEmbeddedEthereumWallet(wallet: PrivyWalletLike | null | undefined) {
  const chainType = wallet?.chainType ?? wallet?.chain_type;
  const walletClientType = wallet?.walletClientType ?? wallet?.wallet_client_type;
  const connectorType = wallet?.connectorType ?? wallet?.connector_type;

  return (
    typeof wallet?.address === "string" &&
    wallet.address.length > 0 &&
    (chainType ?? "ethereum") === "ethereum" &&
    (walletClientType === "privy" ||
      walletClientType === "privy-v2" ||
      connectorType === "embedded")
  );
}

export function resolvePrivyEmbeddedWallet(args: {
  user?: PrivyUserWalletLike | null;
  wallets: PrivyWalletLike[];
  createdWallet?: PrivyWalletLike | null;
}) {
  const linkedWallet = args.user?.linkedAccounts?.find(
    (account) => account.type === "wallet" && isEmbeddedEthereumWallet(account),
  );
  const userWallet = isEmbeddedEthereumWallet(args.user?.wallet) ? args.user?.wallet : null;
  const connectedWallet = args.wallets.find(isEmbeddedEthereumWallet) ?? null;

  return linkedWallet ?? userWallet ?? connectedWallet ?? args.createdWallet ?? null;
}