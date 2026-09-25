"use client";

import { useState } from "react";
import { AlertCircle, LoaderCircle, LogOut, User, WalletCards } from "lucide-react";
import { useWallet } from "@/lib/genlayer/wallet";
import { error, userRejected } from "@/lib/utils/toast";
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

export function AccountPanel() {
  const {
    address,
     isConnected,
     selectedWallet,
     isOnCorrectNetwork,
     isLoading,
     connectWallet,
    disconnectWallet,
    switchWalletAccount,
  } = useWallet();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [isSwitching, setIsSwitching] = useState(false);

  const handleConnect = async () => {
    try {
      setConnectionError("");
      await connectWallet();
    } catch (err: any) {
      const message = err?.message || "The wallet could not be connected.";
      setConnectionError(message);
      if (/reject|cancel/i.test(message)) userRejected("Connection cancelled");
      else error("Failed to connect wallet", { description: message });
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
      <Button aria-label="Connect EVM wallet" disabled={isLoading} onClick={() => void handleConnect()} variant="gradient">
        {isLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <WalletCards className="mr-2 h-4 w-4" />}
        {isLoading ? "Connecting..." : "Connect wallet"}
      </Button>
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
