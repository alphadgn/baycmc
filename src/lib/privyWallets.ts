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

function isEthereumWalletAddress(wallet: PrivyWalletLike | null | undefined) {
  const chainType = wallet?.chainType ?? wallet?.chain_type;
  return typeof wallet?.address === "string" && wallet.address.length > 0 && (chainType ?? "ethereum") === "ethereum";
}

function isClearlyExternalWallet(wallet: PrivyWalletLike | null | undefined) {
  const walletClientType = wallet?.walletClientType ?? wallet?.wallet_client_type;
  const connectorType = wallet?.connectorType ?? wallet?.connector_type;

  if (walletClientType && walletClientType !== "privy" && walletClientType !== "privy-v2") return true;
  if (connectorType && connectorType !== "embedded") return true;
  return false;
}

export function isProvisionedPrivyWallet(wallet: PrivyWalletLike | null | undefined) {
  if (isEmbeddedEthereumWallet(wallet)) return true;
  return isEthereumWalletAddress(wallet) && !isClearlyExternalWallet(wallet);
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

export function resolvePrivyProvisionedWallet(args: {
  user?: PrivyUserWalletLike | null;
  wallets: PrivyWalletLike[];
  createdWallet?: PrivyWalletLike | null;
}) {
  const embedded = resolvePrivyEmbeddedWallet(args);
  if (embedded) return embedded;

  const linkedWallet = args.user?.linkedAccounts?.find(
    (account) => account.type === "wallet" && isProvisionedPrivyWallet(account),
  );
  const userWallet = isProvisionedPrivyWallet(args.user?.wallet) ? args.user?.wallet : null;
  const connectedWallet = args.wallets.find(isProvisionedPrivyWallet) ?? null;
  const createdWallet = isProvisionedPrivyWallet(args.createdWallet) ? args.createdWallet : null;

  return linkedWallet ?? userWallet ?? connectedWallet ?? createdWallet ?? null;
}