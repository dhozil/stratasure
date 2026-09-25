"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import {
  connectWallet,
  clearWalletSelection,
  discoverWalletProviders,
  getAccounts,
  getActiveWallet,
  getCurrentChainId,
  getEthereumProvider,
  getAvailableWallets,
  isOnGenLayerNetwork,
  selectWalletProvider,
  switchAccount,
  GENLAYER_CHAIN_ID,
  type WalletKind,
  type WalletOption,
} from "./client";
import { error, userRejected } from "../utils/toast";

const DISCONNECT_FLAG = "wallet_disconnected";
const WALLET_SELECTION_FLAG = "stratasure_wallet_provider";

export interface WalletState {
  address: string | null;
  chainId: string | null;
  isConnected: boolean;
  isLoading: boolean;
  isMetaMaskInstalled: boolean;
  isRabbyInstalled: boolean;
  isOnCorrectNetwork: boolean;
  selectedWallet: WalletKind | null;
  availableWallets: WalletOption[];
}

interface WalletContextValue extends WalletState {
  connectWallet: () => Promise<string>;
  disconnectWallet: () => void;
  switchWalletAccount: () => Promise<string>;
}

const initialState: WalletState = {
  address: null,
  chainId: null,
  isConnected: false,
  isLoading: true,
  isMetaMaskInstalled: false,
  isRabbyInstalled: false,
  isOnCorrectNetwork: false,
  selectedWallet: null,
  availableWallets: [],
};

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

function walletFlags(wallets: WalletOption[]) {
  return {
    isMetaMaskInstalled: wallets.some((wallet) => wallet.id === "metamask"),
    isRabbyInstalled: wallets.some((wallet) => wallet.id === "rabby"),
  };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>(initialState);

  useEffect(() => {
    const cleanup = discoverWalletProviders((availableWallets) => {
      setState((current) => ({ ...current, availableWallets, isLoading: current.selectedWallet ? current.isLoading : false, ...walletFlags(availableWallets) }));
    });
    return cleanup;
  }, []);

  useEffect(() => {
    const savedWallet = typeof window !== "undefined" ? localStorage.getItem(WALLET_SELECTION_FLAG) as WalletKind | null : null;
    if (!savedWallet || !state.availableWallets.some((wallet) => wallet.id === savedWallet)) return;
    selectWalletProvider(savedWallet);
    let cancelled = false;
    const restore = async () => {
      if (localStorage.getItem(DISCONNECT_FLAG) === "true") return;
      const accounts = await getAccounts();
      const chainId = await getCurrentChainId();
      const correctNetwork = await isOnGenLayerNetwork();
      if (cancelled) return;
      setState((current) => ({
        ...current,
        address: accounts[0] || null,
        chainId,
        isConnected: accounts.length > 0,
        isLoading: false,
        isOnCorrectNetwork: correctNetwork,
        selectedWallet: savedWallet,
        ...walletFlags(current.availableWallets),
      }));
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [state.availableWallets]);

  useEffect(() => {
    const provider = getEthereumProvider();
    if (!provider || !state.selectedWallet) return;
    const handleAccountsChanged = async (accounts: string[]) => {
      const chainId = await getCurrentChainId();
      const correctNetwork = await isOnGenLayerNetwork();
      if (accounts.length > 0 && typeof window !== "undefined") localStorage.removeItem(DISCONNECT_FLAG);
      setState((current) => ({ ...current, address: accounts[0] || null, chainId, isConnected: accounts.length > 0, isOnCorrectNetwork: correctNetwork }));
    };
    const handleChainChanged = async (chainId: string) => {
      const correctNetwork = parseInt(chainId, 16) === GENLAYER_CHAIN_ID;
      const accounts = await getAccounts();
      setState((current) => ({ ...current, chainId, address: accounts[0] || null, isConnected: accounts.length > 0, isOnCorrectNetwork: correctNetwork }));
    };
    const handleDisconnect = () => setState((current) => ({ ...current, address: null, isConnected: false, selectedWallet: null }));
    provider.on("accountsChanged", handleAccountsChanged);
    provider.on("chainChanged", handleChainChanged);
    provider.on("disconnect", handleDisconnect);
    return () => {
      provider.removeListener("accountsChanged", handleAccountsChanged);
      provider.removeListener("chainChanged", handleChainChanged);
      provider.removeListener("disconnect", handleDisconnect);
    };
  }, [state.selectedWallet]);

  const connectSelectedWallet = useCallback(async () => {
    try {
      setState((current) => ({ ...current, isLoading: true }));
      const address = await connectWallet();
      const chainId = await getCurrentChainId();
      const correctNetwork = await isOnGenLayerNetwork();
      const selectedWallet = getActiveWallet();
      if (typeof window !== "undefined") localStorage.removeItem(DISCONNECT_FLAG);
      setState((current) => ({ ...current, address, chainId, isConnected: true, isLoading: false, isOnCorrectNetwork: correctNetwork, selectedWallet, ...walletFlags(current.availableWallets) }));
      return address;
    } catch (err: any) {
      setState((current) => ({ ...current, isLoading: false }));
      const message = err?.message || "Please check your wallet and try again.";
      if (/reject|cancel/i.test(message)) {
        userRejected("Connection cancelled");
      } else {
        error("Failed to connect wallet", { description: message });
      }
      throw err;
    }
  }, []);

  const disconnectWallet = useCallback(() => {
    if (typeof window !== "undefined") localStorage.setItem(DISCONNECT_FLAG, "true");
    clearWalletSelection();
    setState((current) => ({ ...current, address: null, isConnected: false, selectedWallet: null }));
  }, []);

  const switchWalletAccount = useCallback(async () => {
    try {
      setState((current) => ({ ...current, isLoading: true }));
      const newAddress = await switchAccount();
      const chainId = await getCurrentChainId();
      const correctNetwork = await isOnGenLayerNetwork();
      if (typeof window !== "undefined") localStorage.removeItem(DISCONNECT_FLAG);
      setState((current) => ({ ...current, address: newAddress, chainId, isConnected: true, isLoading: false, isOnCorrectNetwork: correctNetwork, selectedWallet: getActiveWallet() }));
      return newAddress;
    } catch (err: any) {
      setState((current) => ({ ...current, isLoading: false }));
      const message = err?.message || "Please try again.";
      if (/reject|cancel/i.test(message)) userRejected("Account switch cancelled");
      else error("Failed to switch account", { description: message });
      throw err;
    }
  }, []);

  const value: WalletContextValue = {
    ...state,
    connectWallet: connectSelectedWallet,
    disconnectWallet,
    switchWalletAccount,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) throw new Error("useWallet must be used within a WalletProvider");
  return context;
}
