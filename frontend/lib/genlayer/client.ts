"use client";

import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { createWalletClient, custom, type WalletClient } from "viem";

export const GENLAYER_CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_GENLAYER_CHAIN_ID || "61999");
export const GENLAYER_CHAIN_ID_HEX = `0x${GENLAYER_CHAIN_ID.toString(16).toUpperCase()}`;

export const GENLAYER_NETWORK = {
  chainId: GENLAYER_CHAIN_ID_HEX,
  chainName: process.env.NEXT_PUBLIC_GENLAYER_CHAIN_NAME || "GenLayer Studio",
  nativeCurrency: {
    name: process.env.NEXT_PUBLIC_GENLAYER_SYMBOL || "GEN",
    symbol: process.env.NEXT_PUBLIC_GENLAYER_SYMBOL || "GEN",
    decimals: 18,
  },
  rpcUrls: [process.env.NEXT_PUBLIC_GENLAYER_RPC_URL || "https://studio.genlayer.com/api"],
  blockExplorerUrls: process.env.NEXT_PUBLIC_EXPLORER_URL
    ? [process.env.NEXT_PUBLIC_EXPLORER_URL]
    : [],
};

export function getStudioUrl(): string {
  return process.env.NEXT_PUBLIC_GENLAYER_RPC_URL || "https://studio.genlayer.com/api";
}

export function getContractAddress(): string {
  return process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";
}

export type WalletKind = "metamask" | "rabby";

type EthereumProvider = {
  isMetaMask?: boolean;
  isRabby?: boolean;
  name?: string;
  providers?: EthereumProvider[];
  request: (args: { method: string; params?: any[] }) => Promise<any>;
  on: (event: string, handler: (...args: any[]) => void) => void;
  removeListener: (event: string, handler: (...args: any[]) => void) => void;
};

type ProviderInfo = {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
};

type ProviderDetail = {
  info: ProviderInfo;
  provider: EthereumProvider;
};

export type WalletOption = {
  id: WalletKind;
  name: string;
  icon: string;
  rdns: string;
  provider: EthereumProvider;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

const announcedProviders = new Map<string, WalletOption>();
let activeProvider: EthereumProvider | null = null;
let activeWallet: WalletKind | null = null;

function walletKind(provider: EthereumProvider, info?: ProviderInfo): WalletKind | null {
  const name = `${provider.name || ""} ${info?.name || ""}`.toLowerCase();
  const rdns = info?.rdns.toLowerCase() || "";
  if (provider.isRabby || name.includes("rabby") || rdns.includes("rabby")) return "rabby";
  if (provider.isMetaMask || name.includes("metamask") || rdns.includes("metamask")) return "metamask";
  return null;
}

function walletOption(provider: EthereumProvider, info?: ProviderInfo): WalletOption | null {
  const id = walletKind(provider, info);
  if (!id) return null;
  return {
    id,
    name: id === "metamask" ? "MetaMask" : "Rabby",
    icon: info?.icon || "",
    rdns: info?.rdns || id,
    provider,
  };
}

function legacyProviders(): EthereumProvider[] {
  if (typeof window === "undefined" || !window.ethereum) return [];
  const providers = window.ethereum.providers?.length ? window.ethereum.providers : [window.ethereum];
  return providers.filter((provider, index, list) => list.indexOf(provider) === index);
}

export function getAvailableWallets(): WalletOption[] {
  const options = new Map<string, WalletOption>();
  announcedProviders.forEach((option) => options.set(option.id, option));
  legacyProviders().forEach((provider) => {
    const option = walletOption(provider);
    if (option) options.set(option.id, option);
  });
  return (["metamask", "rabby"] as WalletKind[])
    .map((id) => options.get(id))
    .filter((option): option is WalletOption => Boolean(option));
}

export function discoverWalletProviders(onChange: (wallets: WalletOption[]) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const update = () => onChange(getAvailableWallets());
  const handleAnnouncement = (event: Event) => {
    const detail = (event as CustomEvent<ProviderDetail>).detail;
    if (!detail?.provider || !detail.info) return;
    const option = walletOption(detail.provider, detail.info);
    if (option) announcedProviders.set(option.id, option);
    update();
  };
  window.addEventListener("eip6963:announceProvider", handleAnnouncement);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  update();
  return () => window.removeEventListener("eip6963:announceProvider", handleAnnouncement);
}

export function isMetaMaskInstalled(): boolean {
  return getAvailableWallets().some((wallet) => wallet.id === "metamask");
}

export function isRabbyInstalled(): boolean {
  return getAvailableWallets().some((wallet) => wallet.id === "rabby");
}

export function getActiveWallet(): WalletKind | null {
  return activeWallet;
}

export function getEthereumProvider(): EthereumProvider | null {
  if (activeProvider) return activeProvider;
  return getAvailableWallets()[0]?.provider || (typeof window !== "undefined" ? window.ethereum || null : null);
}

export function selectWalletProvider(wallet: WalletKind): void {
  const option = getAvailableWallets().find((candidate) => candidate.id === wallet);
  if (!option) {
    const label = wallet === "metamask" ? "MetaMask" : "Rabby";
    throw new Error(`${label} was not detected in this browser`);
  }
  activeProvider = option.provider;
  activeWallet = option.id;
  if (typeof window !== "undefined") localStorage.setItem("stratasure_wallet_provider", option.id);
}

export async function requestAccounts(): Promise<string[]> {
  const provider = getEthereumProvider();
  if (!provider) throw new Error("No Ethereum wallet is connected");
  try {
    return await provider.request({ method: "eth_requestAccounts" });
  } catch (error: any) {
    if (error.code === 4001) throw new Error("User rejected the connection request");
    throw new Error(`Failed to connect wallet: ${error.message}`);
  }
}

export async function getAccounts(): Promise<string[]> {
  const provider = getEthereumProvider();
  if (!provider) return [];
  try {
    return await provider.request({ method: "eth_accounts" });
  } catch {
    return [];
  }
}

export async function getCurrentChainId(): Promise<string | null> {
  const provider = getEthereumProvider();
  if (!provider) return null;
  try {
    return await provider.request({ method: "eth_chainId" });
  } catch {
    return null;
  }
}

export async function addGenLayerNetwork(): Promise<void> {
  const provider = getEthereumProvider();
  if (!provider) throw new Error("No Ethereum wallet is connected");
  try {
    await provider.request({ method: "wallet_addEthereumChain", params: [GENLAYER_NETWORK] });
  } catch (error: any) {
    if (error.code === 4001) throw new Error("User rejected adding the network");
    throw new Error(`Failed to add GenLayer network: ${error.message}`);
  }
}

export async function switchToGenLayerNetwork(): Promise<void> {
  const provider = getEthereumProvider();
  if (!provider) throw new Error("No Ethereum wallet is connected");
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: GENLAYER_CHAIN_ID_HEX }] });
  } catch (error: any) {
    if (error.code === 4902) {
      await addGenLayerNetwork();
    } else if (error.code === 4001) {
      throw new Error("User rejected switching the network");
    } else {
      throw new Error(`Failed to switch network: ${error.message}`);
    }
  }
}

export async function isOnGenLayerNetwork(): Promise<boolean> {
  const chainId = await getCurrentChainId();
  return Boolean(chainId && parseInt(chainId, 16) === GENLAYER_CHAIN_ID);
}

export async function connectWallet(wallet: WalletKind): Promise<string> {
  selectWalletProvider(wallet);
  const accounts = await requestAccounts();
  if (!accounts || accounts.length === 0) throw new Error("No accounts found");
  if (!(await isOnGenLayerNetwork())) await switchToGenLayerNetwork();
  return accounts[0];
}

export async function connectMetaMask(): Promise<string> {
  return connectWallet("metamask");
}

export async function switchAccount(): Promise<string> {
  const provider = getEthereumProvider();
  if (!provider) throw new Error("No Ethereum wallet is connected");
  try {
    await provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
    const accounts = await provider.request({ method: "eth_accounts" });
    if (!accounts || accounts.length === 0) throw new Error("No account selected");
    return accounts[0];
  } catch (error: any) {
    if (error.code === 4001) throw new Error("User rejected account switch");
    if (error.code === -32002) throw new Error("Account switch request already pending");
    throw new Error(`Failed to switch account: ${error.message}`);
  }
}

export function createMetaMaskWalletClient(): WalletClient | null {
  const provider = getEthereumProvider();
  if (!provider) return null;
  try {
    return createWalletClient({ chain: studionet as any, transport: custom(provider) });
  } catch {
    return null;
  }
}

export function createGenLayerClient(address?: string, provider?: EthereumProvider) {
  const config: any = { chain: studionet };
  if (address) config.account = address as `0x${string}`;
  if (provider) config.provider = provider;
  try {
    return createClient(config);
  } catch {
    return createClient({ chain: studionet, ...(provider ? { provider } : {}) });
  }
}

export async function getClient() {
  const provider = getEthereumProvider();
  const accounts = provider
    ? await provider.request({ method: "eth_accounts" })
    : [];
  return createGenLayerClient(accounts[0], provider ?? undefined);
}
