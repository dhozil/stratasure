"use client";

import { useState } from "react";
import { AlertCircle, ExternalLink, LoaderCircle, LogOut, User, WalletCards } from "lucide-react";
import { useWallet } from "@/lib/genlayer/wallet";
import { success, error, userRejected } from "@/lib/utils/toast";
import { AddressDisplay } from "./AddressDisplay";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import type { WalletKind } from "@/lib/genlayer/client";

const INSTALL_URLS: Record<WalletKind, string> = {
  metamask: "https://metamask.io/download/",
  rabby: "https://rabby.io/",
};

const walletCopy: Record<WalletKind, { name: string; description: string }> = {
  metamask: { name: "MetaMask", description: "Connect with the MetaMask extension or mobile wallet bridge." },
  rabby: { name: "Rabby", description: "Connect with the Rabby wallet and its account controls." },
};

export function AccountPanel() {
  const {
    address,
    isConnected,
    isMetaMaskInstalled,
    isRabbyInstalled,
    selectedWallet,
    isOnCorrectNetwork,
    isLoading,
    availableWallets,
    connectWallet,
    disconnectWallet,
    switchWalletAccount,
  } = useWallet();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [connectingWallet, setConnectingWallet] = useState<WalletKind | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const walletOptions = (Object.keys(walletCopy) as WalletKind[]).map((id) => ({ id, ...walletCopy[id], installed: availableWallets.some((wallet) => wallet.id === id) }));

  const handleConnect = async (wallet: WalletKind) => {
    if (!availableWallets.some((option) => option.id === wallet)) return;
    try {
      setConnectingWallet(wallet);
      setConnectionError("");
      await connectWallet(wallet);
      setIsModalOpen(false);
    } catch (err: any) {
      const message = err?.message || "The wallet could not be connected.";
      setConnectionError(message);
      if (/reject|cancel/i.test(message)) userRejected("Connection cancelled");
      else error("Failed to connect wallet", { description: message });
    } finally {
      setConnectingWallet(null);
    }
  };

  const handleDisconnect = () => {
    disconnectWallet();
    setIsModalOpen(false);
  };

  const handleSwitchAccount = async () => {
    try {
      setIsSwitching(true);
      setConnectionError("");
      await switchWalletAccount();
    } catch (err: any) {
      const message = err?.message || "The account could not be changed.";
      setConnectionError(message);
      if (/reject|cancel/i.test(message)) userRejected("Account switch cancelled");
      else error("Failed to switch account", { description: message });
    } finally {
      setIsSwitching(false);
    }
  };

  if (!isConnected) {
    return (
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogTrigger asChild>
          <Button aria-label="Choose a wallet" disabled={isLoading} variant="gradient">
            <WalletCards className="mr-2 h-4 w-4" />
            {isLoading ? "Loading wallet" : "Connect wallet"}
          </Button>
        </DialogTrigger>
        <DialogContent className="brand-card border-2">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">Choose your wallet</DialogTitle>
            <DialogDescription>StrataSure never stores private keys. Choose the wallet you want to use for this session.</DialogDescription>
          </DialogHeader>
          <div className="mt-5 space-y-3">
            {walletOptions.map((wallet) => (
              <div className="rounded-xl border border-[var(--line)] bg-white/[0.025] p-3" key={wallet.id}>
                <Button className="w-full justify-between" disabled={!wallet.installed || connectingWallet !== null} onClick={() => void handleConnect(wallet.id)} variant={wallet.installed ? "gradient" : "outline"}>
                  <span className="flex items-center gap-3">
                    {connectingWallet === wallet.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <WalletCards className="h-4 w-4" />}
                    <span className="text-left"><span className="block">{connectingWallet === wallet.id ? `Connecting ${wallet.name}...` : wallet.name}</span><span className="block text-xs font-normal opacity-70">{wallet.installed ? wallet.description : "Not detected in this browser"}</span></span>
                  </span>
                  {wallet.installed ? <ExternalLink className="h-4 w-4" /> : <AlertCircle className="h-4 w-4 text-[var(--copper)]" />}
                </Button>
                {!wallet.installed ? <Button className="mt-2 w-full" onClick={() => window.open(INSTALL_URLS[wallet.id], "_blank", "noopener,noreferrer")} type="button" variant="ghost"><ExternalLink className="h-3.5 w-3.5" /> Install {wallet.name}</Button> : null}
              </div>
            ))}
            {!isMetaMaskInstalled && !isRabbyInstalled ? <Alert variant="default"><AlertCircle className="h-4 w-4" /><AlertTitle>No wallet detected</AlertTitle><AlertDescription>Install MetaMask or Rabby, then refresh this page to reconnect.</AlertDescription></Alert> : null}
            {connectionError ? <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Connection error</AlertTitle><AlertDescription>{connectionError}</AlertDescription></Alert> : null}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
      <div className="flex items-center gap-4">
        <div className="brand-card flex items-center gap-3 px-4 py-2"><div className="flex items-center gap-2"><User className="h-4 w-4 text-accent" /><AddressDisplay address={address} maxLength={12} /></div><div className="h-4 w-px bg-white/10" /></div>
        <DialogTrigger asChild><Button aria-label="Open wallet details" variant="outline" size="sm"><User className="h-4 w-4" /></Button></DialogTrigger>
      </div>
      <DialogContent className="brand-card border-2">
        <DialogHeader><DialogTitle className="text-2xl font-bold">Wallet details</DialogTitle><DialogDescription>Your connected {selectedWallet === "rabby" ? "Rabby" : "MetaMask"} wallet</DialogDescription></DialogHeader>
        <div className="mt-4 space-y-4">
          <div className="brand-card space-y-2 p-4"><p className="text-sm text-muted-foreground">Your address</p><code className="break-all text-sm font-mono">{address}</code></div>
          <div className="brand-card space-y-2 p-4"><p className="text-sm text-muted-foreground">Coverage account</p><p className="text-2xl font-bold text-accent">Connected</p></div>
          <div className="brand-card space-y-2 p-4"><p className="text-sm text-muted-foreground">Network status</p><div className="flex items-center gap-2"><div className={`h-2 w-2 rounded-full ${isOnCorrectNetwork ? "bg-[var(--lichen)]" : "animate-pulse bg-[var(--copper)]"}`} /><span className="text-sm">{isOnCorrectNetwork ? "Connected to GenLayer" : "Wrong network"}</span></div></div>
          {!isOnCorrectNetwork ? <Alert variant="default" className="border-[rgba(215,139,97,0.32)] bg-[rgba(215,139,97,0.07)]"><AlertCircle className="h-4 w-4 text-[var(--copper)]" /><AlertTitle>Network warning</AlertTitle><AlertDescription>Switch your wallet to the configured GenLayer network before signing.</AlertDescription></Alert> : null}
          {connectionError ? <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{connectionError}</AlertDescription></Alert> : null}
          <div className="mt-6 space-y-3 border-t border-white/10 pt-4"><Button className="w-full" disabled={isSwitching || isLoading} onClick={() => void handleSwitchAccount()} variant="outline"><User className="mr-2 h-4 w-4" />{isSwitching ? "Switching..." : "Switch account"}</Button><Button className="w-full text-destructive hover:text-destructive" disabled={isSwitching || isLoading} onClick={handleDisconnect} variant="outline"><LogOut className="mr-2 h-4 w-4" />Disconnect wallet</Button></div>
          <div className="rounded-lg border border-muted/20 bg-muted/10 p-4"><p className="text-xs text-muted-foreground">Switch account to select another address inside the active wallet. Disconnect ends this session.</p></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
