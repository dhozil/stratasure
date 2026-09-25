"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Droplets,
  ExternalLink,
  FileCheck2,
  Gauge,
  Landmark,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  MapPinned,
  Mountain,
  Orbit,
  Radio,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  WalletCards,
  X,
  XCircle,
} from "lucide-react";
import { Navbar, type AppView } from "@/components/Navbar";
import { AddressDisplay } from "@/components/AddressDisplay";
import { useWallet } from "@/lib/genlayer/wallet";
import { getClient, getContractAddress } from "@/lib/genlayer/client";
import { error, info, success, userRejected } from "@/lib/utils/toast";
import type { ContractInfo, Policy, PolicyEvaluation, RiskSummary } from "@/lib/contracts/types";

const CONTRACT_ADDRESS = getContractAddress();
const EXPLORER_BASE = process.env.NEXT_PUBLIC_EXPLORER_URL;
const ACTIVITY_STORAGE_KEY = "stratasure_activity";
const ACTIVITY_STATUSES: ActionStatus[] = ["idle", "submitting", "submitted", "pending_receipt", "finalized", "failed"];
const ACTIVITY_KINDS: ActivityItem["kind"][] = ["create", "evaluate", "expire", "fund", "withdraw"];

type ActionStatus = "idle" | "submitting" | "submitted" | "pending_receipt" | "finalized" | "failed";
type PolicyForm = {
  peril: "DROUGHT" | "EARTHQUAKE";
  location: string;
  latitude: string;
  longitude: string;
  coverageStart: string;
  coverageEnd: string;
  threshold: string;
  radius: string;
  premium: string;
  payout: string;
};

type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  hash: string;
  status: ActionStatus;
  timestamp: string;
  kind: "create" | "evaluate" | "expire" | "fund" | "withdraw";
  evaluation?: PolicyEvaluation;
  error?: string;
};

type ActionState = {
  status: ActionStatus;
  title: string;
  message: string;
  hash?: string;
};

type SubmissionResult = "finalized" | "failed" | "pending";

const initialForm: PolicyForm = {
  peril: "DROUGHT",
  location: "Bandung",
  latitude: "-6.69",
  longitude: "107",
  coverageStart: "2026-10-01",
  coverageEnd: "2026-12-31",
  threshold: "250",
  radius: "100",
  premium: "1",
  payout: "1",
};

const sourceCards = [
  {
    peril: "DROUGHT",
    source: "NASA POWER",
    icon: Droplets,
    unit: "millimeters",
    description: "Cumulative precipitation across a fixed observation window.",
    accent: "glacier",
  },
  {
    peril: "EARTHQUAKE",
    source: "USGS CATALOG",
    icon: Mountain,
    unit: "millimagnitude",
    description: "A qualifying event inside the policy region and time window.",
    accent: "copper",
  },
];

const processSteps = [
  {
    title: "Lock the terms",
    copy: "Choose a peril, geography, threshold, observation window, premium, and binary payout before the season begins.",
    icon: FileCheck2,
  },
  {
    title: "Read the source",
    copy: "A leader fetches the fixed allowlisted source and derives only the fields that affect settlement.",
    icon: Radio,
  },
  {
    title: "Reach consensus",
    copy: "Validators independently re-fetch the evidence and compare the decision, source, and payout fields.",
    icon: ShieldCheck,
  },
  {
    title: "Settle after finalization",
    copy: "The policy state is only written after consensus. External GEN transfers are emitted for finalization.",
    icon: Orbit,
  },
];

function formatGenAmount(value: string | bigint | number | undefined): string {
  if (value === undefined || value === null || value === "") return "0";
  try {
    return String(value);
  } catch {
    return "0";
  }
}

function parseGenAmount(value: string): bigint {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error("Enter a whole GEN amount.");
  }
  return BigInt(normalized);
}

function parsePositiveInteger(value: string, label: string): bigint {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be a whole positive number.`);
  }
  const parsed = BigInt(normalized);
  if (parsed <= 0n) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return parsed;
}

function parsePositiveGenAmount(value: string, label: string): bigint {
  const parsed = parsePositiveInteger(value, label);
  if (parsed <= 0n) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return parsed;
}

function microdegrees(value: string, label: string): bigint {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`${label} must be a valid coordinate.`);
  return BigInt(Math.round(numeric * 1_000_000));
}

function isEvaluationReady(policy: Policy): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return policy.coverage_end < today;
}

function explorerUrl(hash: string): string | undefined {
  if (!EXPLORER_BASE) return undefined;
  return `${EXPLORER_BASE.replace(/\/$/, "")}/tx/${hash}`;
}

function errorMessage(errorValue: unknown): string {
  if (errorValue instanceof Error) return errorValue.message;
  if (typeof errorValue === "string") return errorValue;
  if (errorValue && typeof errorValue === "object" && "message" in errorValue) {
    return String(errorValue.message);
  }
  return "The transaction could not be completed.";
}

function isUserRejected(errorValue: unknown): boolean {
  return /reject|cancel|denied|4001/i.test(errorMessage(errorValue));
}

function isPendingStatus(status: ActionStatus): boolean {
  return status === "submitted" || status === "pending_receipt";
}

function isFinalizedReceipt(receipt: any): boolean {
  const status = receipt?.statusName ?? receipt?.status;
  return status === "FINALIZED" || status === "Finalized" || status === 7 || status === "7";
}

function isSuccessfulReceipt(receipt: any): boolean {
  if (receipt?.txExecutionResultName === "FINISHED_WITH_RETURN") return true;
  const leaderReceipt = receipt?.consensus_data?.leader_receipt?.find(
    (item: any) => item.mode === "leader",
  );
  return Boolean(
    leaderReceipt?.execution_result === "SUCCESS" &&
      leaderReceipt?.genvm_result?.raw_error == null &&
      leaderReceipt?.result?.status === "return",
  );
}

async function waitForFinalization(client: any, hash: string): Promise<any> {
  if (typeof client.waitForFinalization === "function") {
    return client.waitForFinalization({ hash });
  }
  return client.waitForTransactionReceipt({
    hash,
    status: "FINALIZED",
    interval: 5000,
    retries: 120,
    fullTransaction: false,
  });
}

function receiptMatchesHash(receipt: any, expectedHash: string): boolean {
  if (!receipt || typeof receipt !== "object") return false;
  const expected = expectedHash.toLowerCase();
  const identifiers = ["hash", "txId", "tx_id", "transactionHash"]
    .map((key) => receipt[key])
    .filter((value): value is string => value !== undefined && value !== null && value !== "")
    .map((value) => String(value).toLowerCase());
  return identifiers.length > 0 && identifiers.every((identifier) => identifier === expected);
}

function isStoredActivityItem(value: unknown): value is ActivityItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.detail === "string" &&
    typeof item.hash === "string" &&
    typeof item.timestamp === "string" &&
    ACTIVITY_STATUSES.includes(item.status as ActionStatus) &&
    ACTIVITY_KINDS.includes(item.kind as ActivityItem["kind"])
  );
}

function readStoredActivity(): ActivityItem[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(ACTIVITY_STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredActivityItem).slice(0, 8);
  } catch {
    return [];
  }
}

function writeStoredActivity(items: ActivityItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(items.slice(0, 8)));
  } catch {
    return;
  }
}

function decodeReceiptText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const binary = atob(trimmed);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes).replace(/^[\u0000-\u001f]+/, "").trim();
    return decoded || trimmed;
  } catch {
    return trimmed;
  }
}

function receiptLeader(receipt: any): any {
  const leaderReceipt = receipt?.consensus_data?.leader_receipt;
  if (Array.isArray(leaderReceipt)) return leaderReceipt.find((item: any) => item?.mode === "leader") ?? leaderReceipt[0];
  return leaderReceipt;
}

function receiptError(receipt: any): string {
  const leader = receiptLeader(receipt);
  const candidates = [
    leader?.genvm_result?.error_description,
    leader?.genvm_result?.stderr,
    leader?.result,
    receipt?.genvm_result?.error_description,
    receipt?.genvm_result?.stderr,
    receipt?.error,
    receipt?.txExecutionResultName,
  ];
  for (const candidate of candidates) {
    const message = decodeReceiptText(candidate);
    if (message) return message;
  }
  return "The transaction was finalized without a successful execution result.";
}

function statusTone(status: string): "positive" | "warning" | "negative" | "neutral" {
  if (status === "TRIGGERED" || status === "FINALIZED") return "positive";
  if (status === "ACTIVE" || status === "SUBMITTED") return "warning";
  if (status === "EXPIRED" || status === "FAILED") return "negative";
  return "neutral";
}

function MetricCard({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon: typeof Gauge }) {
  return (
    <div className="panel panel-hover p-5">
      <div className="flex items-start justify-between gap-4">
        <span className="data-label">{label}</span>
        <Icon className="h-4 w-4 text-[var(--lichen-soft)]" />
      </div>
      <p className="mt-6 text-2xl font-semibold tracking-[-0.06em] text-[var(--paper)]">{value}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--fog)]">{note}</p>
    </div>
  );
}

function SourceCard({ source }: { source: (typeof sourceCards)[number] }) {
  const Icon = source.icon;
  return (
    <div className="panel panel-hover p-6">
      <div className="flex items-center justify-between gap-3">
        <span className={`status-pill ${source.accent === "glacier" ? "text-[var(--glacier)]" : "text-[var(--copper)]"}`}>
          <span className="status-dot" />
          {source.peril}
        </span>
        <Icon className="h-5 w-5 text-[var(--fog)]" />
      </div>
      <p className="mt-8 text-xl font-semibold tracking-[-0.05em] text-[var(--paper)]">{source.source}</p>
      <p className="mt-2 text-sm leading-6 text-[var(--mist)]">{source.description}</p>
      <div className="mt-6 flex items-center justify-between border-t border-[var(--line)] pt-4 text-xs text-[var(--fog)]">
        <span>Threshold unit</span>
        <span className="mono text-[var(--mist)]">{source.unit}</span>
      </div>
    </div>
  );
}

function StrataVisual() {
  return (
    <div className="strata-visual" aria-label="StrataSure evidence layers visualization">
      <svg className="strata-lines" viewBox="0 0 600 360" fill="none" aria-hidden="true">
        <path className="strata-line" d="M0 115C70 75 118 155 190 113S318 70 382 113s133 33 218-17" pathLength="1" stroke="#8ccac3" strokeOpacity=".46" style={{ animationDelay: "0s" }} />
        <path className="strata-line" d="M0 150C82 102 121 182 196 143s128-57 190-4 120 53 214-2" pathLength="1" stroke="#c6ed74" strokeOpacity=".55" style={{ animationDelay: "-1.1s" }} />
        <path className="strata-line" d="M0 194C71 161 135 214 207 178s112-39 179 4 124 38 214-12" pathLength="1" stroke="#d78b61" strokeOpacity=".62" style={{ animationDelay: "-2.2s" }} />
        <path className="strata-line" d="M0 247C69 211 121 270 202 232s123-34 188 10 119 26 210-17" pathLength="1" stroke="#8ccac3" strokeOpacity=".36" style={{ animationDelay: "-3.3s" }} />
        <path className="strata-line" d="M0 294C74 258 135 315 213 277s117-23 183 18 122 19 204-23" pathLength="1" stroke="#c6ed74" strokeOpacity=".27" style={{ animationDelay: "-4.4s" }} />
        <path d="M54 0v360M168 0v360M285 0v360M401 0v360M518 0v360" stroke="#edf0e3" strokeOpacity=".06" />
      </svg>
      <span className="strata-label left-[10%] top-[16%]">allowlisted source</span>
      <span className="strata-label right-[9%] top-[36%]">validator evidence</span>
      <span className="strata-label left-[12%] bottom-[20%]">finalized settlement</span>
      <div className="strata-core">
        <span className="text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--mist)]">
          objective<br />trigger
        </span>
      </div>
    </div>
  );
}

function EmptyState({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) {
  return (
    <div className="panel-soft flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
      <Layers3 className="h-7 w-7 text-[var(--lichen-soft)]" />
      <h3 className="mt-5 text-lg font-semibold tracking-[-0.03em] text-[var(--paper)]">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--mist)]">{copy}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

function ActionBanner({ action }: { action: ActionState }) {
  if (action.status === "idle") return null;
  const isWorking = action.status === "submitting" || action.status === "submitted" || action.status === "pending_receipt";
  const isFailed = action.status === "failed";
  const isDone = action.status === "finalized";
  const link = action.hash ? explorerUrl(action.hash) : undefined;

  return (
    <div className={`panel p-5 ${isFailed ? "border-[rgba(222,104,89,0.4)]" : isDone ? "border-[rgba(198,237,116,0.35)]" : ""}`}>
      <div className="flex items-start gap-4">
        {isWorking ? <LoaderCircle className="mt-0.5 h-5 w-5 animate-spin text-[var(--lichen)]" /> : null}
        {isDone ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-[var(--lichen)]" /> : null}
        {isFailed ? <XCircle className="mt-0.5 h-5 w-5 text-[#ed8a76]" /> : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-[var(--paper)]">{action.title}</h3>
            <span className="status-pill" data-tone={isFailed ? "negative" : isDone ? "positive" : "warning"}>
              <span className="status-dot" />
              {action.status}
            </span>
          </div>
          {isFailed ? <div className="mt-3 rounded-xl border border-[rgba(222,104,89,0.25)] bg-[rgba(222,104,89,0.06)] p-3"><p className="data-label text-[#ed8a76]">Error message</p><p className="mt-2 break-words mono text-xs leading-5 text-[var(--paper)]">{action.message}</p></div> : <p className="mt-2 text-sm leading-6 text-[var(--mist)]">{action.message}</p>}
          {action.hash ? <p className="mt-3 truncate mono text-xs text-[var(--fog)]">{action.hash}</p> : null}
          {link ? (
            <a className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--lichen)] hover:underline" href={link} target="_blank" rel="noreferrer">
              View in explorer <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function StrataSureApp() {
  const { address, isConnected, isOnCorrectNetwork } = useWallet();
  const [activeView, setActiveView] = useState<AppView>("overview");
  const [client, setClient] = useState<any>(null);
  const [contractInfo, setContractInfo] = useState<ContractInfo | null>(null);
  const [riskSummary, setRiskSummary] = useState<RiskSummary | null>(null);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [policyEvaluations, setPolicyEvaluations] = useState<Record<string, PolicyEvaluation>>({});
  const [focusPolicyId, setFocusPolicyId] = useState<string | null>(null);
  const [evaluatingPolicyId, setEvaluatingPolicyId] = useState<number | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityHydrated, setActivityHydrated] = useState(false);
  const [action, setAction] = useState<ActionState>({ status: "idle", title: "", message: "" });
  const [form, setForm] = useState<PolicyForm>(initialForm);
  const [portfolioError, setPortfolioError] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const trackingHashes = useRef<Set<string>>(new Set());

  const contractAddress = CONTRACT_ADDRESS as `0x${string}` | "";

  useEffect(() => {
    const restoredActivity = readStoredActivity().map((item) => isPendingStatus(item.status) ? { ...item, status: "pending_receipt" as const } : item);
    setActivity(restoredActivity);
    setActivityHydrated(true);
    const pendingActivity = restoredActivity.find((item) => item.status === "pending_receipt");
    if (pendingActivity) {
      setAction({ status: "pending_receipt", title: pendingActivity.title, message: "Receipt tracking is pending. StrataSure will resume this transaction after the client is ready.", hash: pendingActivity.hash });
    }
  }, []);

  useEffect(() => {
    if (activityHydrated) writeStoredActivity(activity);
  }, [activity, activityHydrated]);

  useEffect(() => {
    if (action.status === "finalized" || action.status === "failed") setEvaluatingPolicyId(null);
  }, [action.status]);

  const loadPortfolio = useCallback(async () => {
    if (!client || !contractAddress) return;
    setIsRefreshing(true);
    setPortfolioError("");
    try {
      const [info, summary, count] = await Promise.all([
        client.readContract({ address: contractAddress, functionName: "get_contract_info", args: [] }),
        client.readContract({ address: contractAddress, functionName: "get_risk_summary", args: [] }),
        client.readContract({ address: contractAddress, functionName: "get_policy_count", args: [] }),
      ]);
      const policyCount = Number(count);
       const loadedPolicies = await Promise.all(
         Array.from({ length: policyCount }, (_, index) =>
           client.readContract({ address: contractAddress, functionName: "get_policy", args: [BigInt(index)] }),
         ),
       );
       const loadedEvaluations = await Promise.all(
         loadedPolicies.map(async (policy) => {
           if (policy.status !== "TRIGGERED" && policy.status !== "NOT_TRIGGERED") return null;
           try {
             return await client.readContract({ address: contractAddress, functionName: "get_evaluation", args: [BigInt(policy.policy_id)] }) as PolicyEvaluation;
           } catch {
             return null;
           }
         }),
       );
       setContractInfo(info as ContractInfo);
       setRiskSummary(summary as RiskSummary);
       setPolicies(loadedPolicies as Policy[]);
       setPolicyEvaluations(Object.fromEntries(loadedEvaluations.filter((evaluation): evaluation is PolicyEvaluation => evaluation !== null).map((evaluation) => [evaluation.policy_id, evaluation])));
    } catch (loadError) {
      setPortfolioError(errorMessage(loadError));
    } finally {
      setIsRefreshing(false);
    }
  }, [client, contractAddress]);

  useEffect(() => {
    if (!isConnected || !address) {
      setClient(null);
      return;
    }
    getClient().then(setClient).catch((connectError) => setPortfolioError(errorMessage(connectError)));
  }, [address, isConnected]);

  useEffect(() => {
    loadPortfolio();
  }, [loadPortfolio]);

  const updateForm = (key: keyof PolicyForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const addActivity = (item: ActivityItem) => {
    setActivity((current) => [item, ...current].slice(0, 8));
  };

  const markPending = useCallback((title: string, hash: string) => {
    setActivity((current) => current.map((item) => item.hash === hash ? { ...item, status: "pending_receipt" } : item));
    setAction((current) => current.hash && current.hash !== hash ? current : {
      status: "pending_receipt",
      title,
      message: "Receipt tracking is pending. StrataSure will resume this transaction after the client is ready.",
      hash,
    });
  }, []);

  const markFailed = useCallback((title: string, hash: string, message: string) => {
    setActivity((current) => current.map((item) => item.hash === hash ? { ...item, status: "failed", error: message } : item));
    setAction((current) => current.hash && current.hash !== hash ? current : {
      status: "failed",
      title: `${title} failed`,
      message,
      hash,
    });
  }, []);

  const trackTransaction = useCallback(async (item: ActivityItem) => {
    const hash = item.hash;
    if (!hash || trackingHashes.current.has(hash)) return;
    trackingHashes.current.add(hash);
    try {
      const receipt = await waitForFinalization(client, hash);
      if (!receiptMatchesHash(receipt, hash) || !isFinalizedReceipt(receipt)) {
        markPending(item.title, hash);
        return;
      }
      if (!isSuccessfulReceipt(receipt)) {
        const message = receiptError(receipt);
        markFailed(item.title, hash, message);
        error(`${item.title} failed`, { description: message });
        return;
      }
      setAction((current) => current.hash === hash ? { status: "finalized", title: `${item.title} finalized`, message: "The execution result succeeded. StrataSure state is now settled.", hash } : current);
      setActivity((current) => current.map((currentItem) => currentItem.hash === hash ? { ...currentItem, status: "finalized" } : currentItem));
      success(`${item.title} finalized`, { description: "The transaction execution succeeded.", ...(explorerUrl(hash) ? { action: { label: "Open explorer", onClick: () => window.open(explorerUrl(hash), "_blank", "noopener,noreferrer") } } : {}) });
      await loadPortfolio();
    } catch {
      markPending(item.title, hash);
    } finally {
      trackingHashes.current.delete(hash);
    }
  }, [client, loadPortfolio, markFailed, markPending]);

  useEffect(() => {
    if (!client) return;
    activity.filter((item) => isPendingStatus(item.status)).forEach((item) => void trackTransaction(item));
  }, [activity, client, trackTransaction]);

  const submitTransaction = async (details: {
    title: string;
    kind: ActivityItem["kind"];
    functionName: string;
    args: unknown[];
    value?: bigint;
    evaluationPolicyId?: number;
  }): Promise<SubmissionResult> => {
    if (isPendingStatus(action.status) || action.status === "submitting" || activity.some((item) => isPendingStatus(item.status))) {
        info("A StrataSure transaction is already in progress", { description: "Wait for the current transaction to finalize before submitting another one." });
        return "failed";
    }
    if (!isConnected) {
        info("Connect a wallet to continue", { description: "StrataSure needs an address to sign this transaction." });
        return "failed";
    }
    if (!isOnCorrectNetwork) {
        error("Switch to the GenLayer network", { description: "The wallet is connected to a different chain." });
        return "failed";
    }
    if (!client || !contractAddress) {
        error("StrataSure is not ready", { description: contractAddress ? "The GenLayer client could not be created." : "Set NEXT_PUBLIC_CONTRACT_ADDRESS before using policy actions." });
        return "failed";
    }

    const value = details.value ?? 0n;
    let hash: string | undefined;
    setAction({ status: "submitting", title: details.title, message: "Waiting for your wallet signature." });
    try {
      let fees: { distribution: any; feeValue?: any } | undefined;
      if (typeof client.estimateTransactionFees === "function") {
        try {
          const estimate = await client.estimateTransactionFees({});
          fees = { distribution: estimate.distribution, feeValue: estimate.feeValue };
        } catch (estimateError) {
          if (!String(estimateError).includes("sim_getFeeConfig")) throw estimateError;
        }
      }
      const txHash = await client.writeContract({
        address: contractAddress,
        functionName: details.functionName,
        args: details.args,
        value,
        ...(fees ? { fees } : {}),
      });
      const submittedHash = String(txHash);
      hash = submittedHash;
      trackingHashes.current.add(submittedHash);
      setAction({ status: "submitted", title: details.title, message: "Transaction submitted. Waiting for finalization.", hash: submittedHash });
      addActivity({ id: `${Date.now()}-${details.kind}`, title: details.title, detail: `${details.functionName} · ${value ? `${formatGenAmount(value)} GEN` : "No value attached"}`, hash: submittedHash, status: "submitted", timestamp: new Date().toISOString(), kind: details.kind });
      const receipt = await waitForFinalization(client, submittedHash);
       if (!receiptMatchesHash(receipt, submittedHash) || !isFinalizedReceipt(receipt)) {
          markPending(details.title, submittedHash);
          return "pending";
       }
      if (!isSuccessfulReceipt(receipt)) {
        const message = receiptError(receipt);
         markFailed(details.title, submittedHash, message);
          error(`${details.title} failed`, { description: message });
          return "failed";
      }
      let evaluation: PolicyEvaluation | undefined;
      let evaluationMessage = "The transaction finalized. Consensus details will appear when the evaluation record is available.";
      if (details.evaluationPolicyId !== undefined) {
        try {
          evaluation = await client.readContract({
            address: contractAddress,
            functionName: "get_evaluation",
            args: [BigInt(details.evaluationPolicyId)],
          }) as PolicyEvaluation;
          evaluationMessage = `Consensus ${evaluation.decision} · observed ${String(evaluation.observed_value ?? "—")} · verification stored in the activity record`;
        } catch {
          evaluationMessage = "The transaction finalized, but the evaluation record is temporarily unavailable. The completed transaction remains linked to the explorer.";
        }
      }
      const finalizedDetail = evaluation
        ? `${details.functionName} · ${evaluation.decision} · observed ${String(evaluation.observed_value ?? "—")}`
        : `${details.functionName} · finalized`;
       setAction({ status: "finalized", title: `${details.title} finalized`, message: evaluationMessage, hash: submittedHash });
       setActivity((current) => current.map((item) => item.hash === submittedHash ? { ...item, status: "finalized", detail: finalizedDetail, evaluation, error: undefined } : item));
       if (evaluation && details.evaluationPolicyId !== undefined) {
         setPolicyEvaluations((current) => ({ ...current, [String(details.evaluationPolicyId)]: evaluation }));
         setFocusPolicyId(String(details.evaluationPolicyId));
         setActiveView("policies");
       } else if (details.evaluationPolicyId !== undefined) {
         setFocusPolicyId(String(details.evaluationPolicyId));
         setActiveView("policies");
       }
       success(`${details.title} finalized`, { description: evaluation ? "Consensus result and transaction receipt are available." : "The transaction execution succeeded.", ...(explorerUrl(submittedHash) ? { action: { label: "Open explorer", onClick: () => window.open(explorerUrl(submittedHash), "_blank", "noopener,noreferrer") } } : {}) });
       await loadPortfolio();
        return "finalized";
     } catch (submitError) {
       if (hash) {
         trackingHashes.current.delete(hash);
          markPending(details.title, hash);
          return "pending";
       }
      const message = errorMessage(submitError);
      setAction({ status: "failed", title: `${details.title} failed`, message });
      if (isUserRejected(submitError)) {
        userRejected(`${details.title} cancelled`);
       } else {
         error(`${details.title} failed`, { description: message });
        }
        return "failed";
      }
    };

  const createPolicy = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const premium = parsePositiveGenAmount(form.premium, "Premium");
      const payout = parsePositiveGenAmount(form.payout, "Payout if triggered");
      const threshold = parsePositiveInteger(form.threshold, "Threshold");
      const radius = form.peril === "EARTHQUAKE" ? parsePositiveInteger(form.radius, "Earthquake radius") : 0n;
      const availableCoverage = parseGenAmount(withdrawableBalance);
      if (payout > availableCoverage) throw new Error(`Payout exceeds available risk-pool capacity: ${withdrawableBalance} GEN.`);
      if (form.coverageEnd <= form.coverageStart) throw new Error("Coverage end must be after coverage start.");
      if (form.coverageStart < new Date().toISOString().slice(0, 10)) throw new Error("Coverage cannot start in the past.");
       const submissionResult = await submitTransaction({
         title: "Create policy",
         kind: "create",
         functionName: "create_policy",
         args: [form.peril, form.location.trim(), microdegrees(form.latitude, "Latitude"), microdegrees(form.longitude, "Longitude"), form.coverageStart, form.coverageEnd, threshold, radius, premium, payout],
         value: premium,
       });
       if (submissionResult === "finalized") {
         try {
           const count = await client.readContract({ address: contractAddress, functionName: "get_policy_count", args: [] });
           setFocusPolicyId(String(Number(count) - 1));
         } catch {
           setFocusPolicyId(null);
         }
         setActiveView("policies");
       }
     } catch (formError) {
      error("Policy terms need attention", { description: errorMessage(formError) });
    }
  };

  const evaluatePolicy = async (policy: Policy) => {
    const policyId = Number(policy.policy_id);
    setEvaluatingPolicyId(policyId);
    try {
      const result = await submitTransaction({ title: `Evaluate policy #${policy.policy_id}`, kind: "evaluate", functionName: "evaluate_policy", args: [BigInt(policy.policy_id)], evaluationPolicyId: policyId });
      if (result !== "pending") setEvaluatingPolicyId((current) => current === policyId ? null : current);
    } catch {
      setEvaluatingPolicyId((current) => current === policyId ? null : current);
    }
  };

  const expirePolicy = async (policy: Policy) => {
    await submitTransaction({ title: `Expire policy #${policy.policy_id}`, kind: "expire", functionName: "expire_policy", args: [BigInt(policy.policy_id)] });
  };

  const withdrawExcess = async (amount: string) => {
    try {
      const value = parseGenAmount(amount);
      if (value <= 0n) throw new Error("Withdrawal amount must be positive.");
      await submitTransaction({ title: "Withdraw excess pool", kind: "withdraw", functionName: "withdraw_excess", args: [value] });
    } catch (withdrawError) {
      error("Withdrawal needs attention", { description: errorMessage(withdrawError) });
    }
  };

  const poolBalance = useMemo(() => formatGenAmount(riskSummary?.pool_balance), [riskSummary]);
  const totalCoverage = useMemo(() => formatGenAmount(riskSummary?.total_coverage), [riskSummary]);
  const totalPremiums = useMemo(() => formatGenAmount(riskSummary?.total_premiums), [riskSummary]);
  const withdrawableBalance = useMemo(() => {
    try {
      const pool = BigInt(riskSummary?.pool_balance ?? "0");
      const coverage = BigInt(riskSummary?.total_coverage ?? "0");
      return formatGenAmount(pool > coverage ? pool - coverage : 0n);
    } catch {
      return "0";
    }
  }, [riskSummary]);
  const activePolicies = policies.filter((policy) => policy.status === "ACTIVE");

  return (
    <div className="site-shell min-h-screen">
      <Navbar activeView={activeView} onNavigate={setActiveView} />
      <main className="mx-auto w-full max-w-[1600px] px-5 pb-20 pt-12 lg:px-8 lg:pt-20">
        <ActionBanner action={action} />
        {portfolioError ? (
          <div className="mt-5 rounded-xl border border-[rgba(222,104,89,0.35)] bg-[rgba(222,104,89,0.07)] p-4 text-sm text-[#f1a18e]">
            <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{portfolioError}</span></div>
          </div>
        ) : null}

        {activeView === "overview" ? (
          <OverviewView
            contractInfo={contractInfo}
            poolBalance={poolBalance}
            totalCoverage={totalCoverage}
             totalPremiums={totalPremiums}
             withdrawableBalance={withdrawableBalance}
             policies={policies}
             evaluations={policyEvaluations}
             evaluatingPolicyId={evaluatingPolicyId}
             focusPolicyId={focusPolicyId}
             activePolicies={activePolicies}
            isConnected={isConnected}
            isOnCorrectNetwork={isOnCorrectNetwork}
            address={address}
            isContractConfigured={Boolean(contractAddress)}
            isRefreshing={isRefreshing}
            onRefresh={loadPortfolio}
             onNavigate={setActiveView}
             onEvaluate={evaluatePolicy}
             onWithdraw={withdrawExcess}
             actionInProgress={action.status === "submitting" || action.status === "submitted" || action.status === "pending_receipt"}
          />
         ) : null}
         {activeView === "policies" ? (
           <PoliciesView address={address} evaluations={policyEvaluations} evaluatingPolicyId={evaluatingPolicyId} focusPolicyId={focusPolicyId} isConnected={isConnected} onEvaluate={evaluatePolicy} policies={policies} />
         ) : null}
         {activeView === "create" ? (
          <CreateView availableCoverage={withdrawableBalance} form={form} updateForm={updateForm} onSubmit={createPolicy} isConnected={isConnected} isOnCorrectNetwork={isOnCorrectNetwork} isContractConfigured={Boolean(contractAddress)} actionInProgress={action.status === "submitting" || action.status === "submitted" || action.status === "pending_receipt"} />
        ) : null}
        {activeView === "how" ? <HowItWorksView contractInfo={contractInfo} /> : null}
        {activeView === "activity" ? <ActivityView activity={activity} /> : null}
      </main>
      <footer className="border-t border-[var(--line)] px-5 py-8 lg:px-8">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-2 text-xs text-[var(--fog)] sm:flex-row sm:items-center sm:justify-between">
          <span>StrataSure · objective parametric settlement on GenLayer</span>
          <span>Source-backed evidence · permissionless evaluation · finalized GEN payouts</span>
        </div>
      </footer>
    </div>
  );
}

function PoliciesView({
  address,
  evaluations,
  evaluatingPolicyId,
  focusPolicyId,
  isConnected,
  onEvaluate,
  policies,
}: {
  address: string | null;
  evaluations: Record<string, PolicyEvaluation>;
  evaluatingPolicyId: number | null;
  focusPolicyId: string | null;
  isConnected: boolean;
  onEvaluate: (policy: Policy) => Promise<void>;
  policies: Policy[];
}) {
  const ownedPolicies = isConnected && address
    ? policies.filter((policy) => policy.insured.toLowerCase() === address.toLowerCase())
    : [];
  const activePolicies = policies.filter((policy) => policy.status === "ACTIVE");
  const settledPolicies = policies.filter((policy) => policy.status === "TRIGGERED" || policy.status === "NOT_TRIGGERED");
  const expiredPolicies = policies.filter((policy) => policy.status === "EXPIRED");
  type PolicyTab = "mine" | "active" | "settled" | "expired";
  const [policyTab, setPolicyTab] = useState<PolicyTab>("mine");
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const visiblePolicies = policyTab === "mine" ? ownedPolicies : policyTab === "active" ? activePolicies : policyTab === "settled" ? settledPolicies : expiredPolicies;
  const tabLabels: { id: PolicyTab; label: string; count: number }[] = [
    { id: "mine", label: "My policies", count: ownedPolicies.length },
    { id: "active", label: "Active", count: activePolicies.length },
    { id: "settled", label: "Settled", count: settledPolicies.length },
    { id: "expired", label: "Expired", count: expiredPolicies.length },
  ];
  const selectedEvaluation = selectedPolicyId ? evaluations[selectedPolicyId] : undefined;
  const sectionProps = { evaluations, evaluatingPolicyId, focusPolicyId, onEvaluate, onShowEvaluation: (policy: Policy) => setSelectedPolicyId(policy.policy_id) };

  return (
    <div className="fade-up">
      <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <div>
          <span className="eyebrow">Policy desk / organized coverage</span>
          <h1 className="section-title mt-5 text-5xl sm:text-6xl">Your policy book.</h1>
          <p className="section-copy mt-5 max-w-2xl">Every policy has one clear home: active exposure awaiting evidence, settled decisions, or expired coverage released back to the pool.</p>
        </div>
        <span className="status-pill" data-tone="positive"><span className="status-dot" />{policies.length} total policies</span>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="My policies" value={String(ownedPolicies.length)} note={isConnected ? "Owned by the connected wallet" : "Connect a wallet to identify ownership"} icon={WalletCards} />
        <MetricCard label="Active coverage" value={String(activePolicies.length)} note="Awaiting evaluation or expiry" icon={ShieldCheck} />
        <MetricCard label="Settled" value={String(settledPolicies.length)} note="Triggered or not triggered" icon={CheckCircle2} />
        <MetricCard label="Expired" value={String(expiredPolicies.length)} note="Coverage released" icon={Clock3} />
      </div>

      <section className="mt-16">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div><span className="eyebrow">Policy filters</span><h2 className="section-title mt-4 text-3xl">Policy book</h2></div>
          {address && isConnected ? <p className="text-xs text-[var(--fog)]">Owner: <AddressDisplay address={address} maxLength={10} showCopy /></p> : null}
        </div>
        <div className="mt-7 flex flex-wrap gap-2 border-b border-[var(--line)] pb-3">
          {tabLabels.map((tab) => <button aria-pressed={policyTab === tab.id} className={`rounded-full border px-4 py-2 text-xs font-semibold transition ${policyTab === tab.id ? "border-[var(--copper)] bg-[var(--copper)] text-[var(--ink)]" : "border-[var(--line)] text-[var(--fog)] hover:border-[var(--copper)] hover:text-[var(--mist)]"}`} key={tab.id} onClick={() => setPolicyTab(tab.id)} type="button">{tab.label} <span className="ml-1 opacity-70">{tab.count}</span></button>)}
        </div>
        {visiblePolicies.length ? <PolicyTable policies={visiblePolicies} {...sectionProps} /> : <div className="mt-6"><EmptyState title={policyTab === "mine" ? (isConnected ? "No policies from this wallet yet" : "Connect to identify your policies") : policyTab === "active" ? "No active policies" : policyTab === "settled" ? "No settled policies yet" : "No expired policies"} copy={policyTab === "mine" ? (isConnected ? "Create a policy and it will appear here automatically after finalization." : "Your policy ownership is tied to the wallet that creates the policy.") : policyTab === "active" ? "Every finalized policy will appear here while its observation window is open or awaiting evaluation." : policyTab === "settled" ? "A triggered or not-triggered consensus decision will be preserved here with its evidence." : "Expired coverage remains auditable here after the pool reserve is released."} /></div>}
      </section>
      {selectedEvaluation ? <EvaluationDetailModal evaluation={selectedEvaluation} onClose={() => setSelectedPolicyId(null)} /> : null}
    </div>
  );
}

function OverviewView({
  contractInfo,
  poolBalance,
  totalCoverage,
  totalPremiums,
  withdrawableBalance,
  policies,
  evaluations,
  evaluatingPolicyId,
  focusPolicyId,
  activePolicies,
  isConnected,
  isOnCorrectNetwork,
  isContractConfigured,
  address,
  isRefreshing,
  onRefresh,
  onNavigate,
  onEvaluate,
  onWithdraw,
  actionInProgress,
}: {
  contractInfo: ContractInfo | null;
  poolBalance: string;
  totalCoverage: string;
  totalPremiums: string;
  withdrawableBalance: string;
  policies: Policy[];
  evaluations: Record<string, PolicyEvaluation>;
  evaluatingPolicyId: number | null;
  focusPolicyId: string | null;
  activePolicies: Policy[];
  isConnected: boolean;
  isOnCorrectNetwork: boolean;
  isContractConfigured: boolean;
  address: string | null;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  onNavigate: (view: AppView) => void;
  onEvaluate: (policy: Policy) => Promise<void>;
  onWithdraw: (amount: string) => Promise<void>;
  actionInProgress: boolean;
}) {
  return (
    <div className="fade-up">
      <section className="grid items-center gap-12 lg:grid-cols-[1.02fr_0.98fr] lg:gap-16">
        <div>
          <span className="eyebrow">StrataSure / protocol overview</span>
          <h1 className="display-title">A measured layer between <em>evidence</em> and capital.</h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-[var(--mist)]">StrataSure turns drought and earthquake observations into auditable policy decisions. The protocol owns settlement; external sources own facts; validators independently check the result.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button className="action-button px-5" onClick={() => onNavigate("create")} type="button">Create a policy <ArrowRight className="h-4 w-4" /></button>
            <button className="secondary-button px-5" onClick={() => onNavigate("how")} type="button">See the protocol <ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="mt-9 flex flex-wrap items-center gap-4 text-xs text-[var(--fog)]">
            <span className="status-pill" data-tone="positive"><span className="status-dot" />Permissionless evaluation</span>
            <span className="status-pill"><span className="status-dot" />GEN payout asset</span>
            <span className="status-pill"><span className="status-dot" />Two fixed perils</span>
          </div>
        </div>
        <StrataVisual />
      </section>

      <section className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Risk pool" value={`${poolBalance} GEN`} note="Available capital before policy coverage." icon={Landmark} />
        <MetricCard label="Active exposure" value={`${totalCoverage} GEN`} note="Coverage currently reserved by active policies." icon={ShieldCheck} />
        <MetricCard label="Premium ledger" value={`${totalPremiums} GEN`} note="Premium collected across the policy book." icon={Gauge} />
        <MetricCard label="Policy book" value={String(policies.length)} note={`${activePolicies.length} policy${activePolicies.length === 1 ? "" : "ies"} currently active.`} icon={Layers3} />
      </section>

      <section className="mt-8">
        <OwnerWithdrawPanel
          actionInProgress={actionInProgress}
          isConnected={isConnected}
          isContractConfigured={isContractConfigured}
          isOnCorrectNetwork={isOnCorrectNetwork}
          onWithdraw={onWithdraw}
          withdrawableBalance={withdrawableBalance}
        />
      </section>

      <section className="mt-20 grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <span className="eyebrow">The settlement stack</span>
          <h2 className="section-title mt-5">Nothing settles on a single answer.</h2>
          <p className="section-copy mt-5">Every policy keeps its source, threshold, evidence, decision, and payout path close at hand. That is the difference between an automated signal and an auditable agreement.</p>
          <div className="mt-7 flex items-center gap-3 text-sm text-[var(--mist)]"><Check className="h-4 w-4 text-[var(--lichen)]" />Fixed sources and binary triggers</div>
          <div className="mt-3 flex items-center gap-3 text-sm text-[var(--mist)]"><Check className="h-4 w-4 text-[var(--lichen)]" />Independent validator evidence</div>
          <div className="mt-3 flex items-center gap-3 text-sm text-[var(--mist)]"><Check className="h-4 w-4 text-[var(--lichen)]" />Finalized external transfers</div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {sourceCards.map((source) => <SourceCard key={source.peril} source={source} />)}
        </div>
      </section>

      <section className="mt-20">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div><span className="eyebrow">Policy book</span><h2 className="section-title mt-5">Open coverage</h2></div>
          <div className="flex items-center gap-3"><span className={`status-pill ${isContractConfigured && isConnected && isOnCorrectNetwork ? "data-[tone=positive]" : ""}`}><span className="status-dot" />{!isContractConfigured ? "Contract address pending" : isConnected && isOnCorrectNetwork ? "Wallet ready" : "Read-only mode"}</span><button aria-label="Refresh policy book" className="secondary-button h-10 w-10 min-h-0 p-0" disabled={!isContractConfigured || isRefreshing} onClick={() => void onRefresh()} type="button"><RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} /></button></div>
        </div>
        {address && isConnected ? <p className="mt-3 text-xs text-[var(--fog)]">Connected account: <AddressDisplay address={address} maxLength={8} showCopy /></p> : null}
        {policies.length ? (
           <PolicyTable evaluations={evaluations} evaluatingPolicyId={evaluatingPolicyId} focusPolicyId={focusPolicyId} policies={policies} onEvaluate={onEvaluate} />
        ) : (
          <div className="mt-6"><EmptyState title="No policies in the book yet" copy="Create the first coverage window to make the protocol tangible. You can inspect the evidence and settlement path before you commit capital." action={<button className="action-button px-4" onClick={() => onNavigate("create")} type="button">Create a policy <ArrowRight className="h-4 w-4" /></button>} /></div>
        )}
      </section>

      {contractInfo ? <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-[var(--fog)]"><span>Protocol {contractInfo.name} · initial release</span><span>Evaluation access: {contractInfo.evaluation_access}</span><span>Perils: {contractInfo.perils.join(" + ")}</span></div> : null}
    </div>
  );
}

function OwnerWithdrawPanel({
  actionInProgress,
  isConnected,
  isContractConfigured,
  isOnCorrectNetwork,
  onWithdraw,
  withdrawableBalance,
}: {
  actionInProgress: boolean;
  isConnected: boolean;
  isContractConfigured: boolean;
  isOnCorrectNetwork: boolean;
  onWithdraw: (amount: string) => Promise<void>;
  withdrawableBalance: string;
}) {
  const [amount, setAmount] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onWithdraw(amount);
  };
  const disabled = actionInProgress || !isConnected || !isContractConfigured || !isOnCorrectNetwork;
  return (
    <div className="panel flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="max-w-xl">
        <span className="eyebrow">Owner controls / excess liquidity</span>
        <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em]">Withdraw only what is not reserved.</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--mist)]">Available beyond active coverage: <span className="mono text-[var(--paper)]">{withdrawableBalance} GEN</span>. The contract rejects withdrawals that touch policy reserves.</p>
      </div>
      <form className="flex w-full max-w-md items-end gap-3" onSubmit={(event) => void submit(event)}>
        <label className="form-label flex-1">Amount<input className="form-control mono" disabled={disabled} inputMode="decimal" min="0" onChange={(event) => setAmount(event.target.value)} placeholder={withdrawableBalance} step="1" type="number" value={amount} /></label>
        <button className="action-button min-h-11" disabled={disabled || !amount} type="submit">Withdraw <ArrowRight className="h-4 w-4" /></button>
      </form>
    </div>
  );
}

function PolicyTable({ evaluations, evaluatingPolicyId, focusPolicyId, onEvaluate, onShowEvaluation, policies }: { evaluations: Record<string, PolicyEvaluation>; evaluatingPolicyId: number | null; focusPolicyId: string | null; onEvaluate: (policy: Policy) => Promise<void>; onShowEvaluation?: (policy: Policy) => void; policies: Policy[] }) {
  return (
    <div className="panel mt-6 overflow-x-auto p-5 sm:p-6">
      <table className="data-table w-full min-w-[720px] border-collapse">
        <thead><tr><th>Policy</th><th>Peril</th><th>Window</th><th>Payout</th><th>Status</th><th /></tr></thead>
        <tbody>
          {policies.map((policy) => (
             <tr className={focusPolicyId === String(policy.policy_id) ? "bg-[rgba(198,237,116,0.07)]" : ""} key={policy.policy_id}>
              <td><span className="mono text-xs text-[var(--fog)]">#{policy.policy_id}</span><p className="mt-1 text-sm text-[var(--paper)]">{policy.location}</p></td>
              <td><span className="mono text-xs text-[var(--mist)]">{policy.peril}</span><a className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--lichen)] hover:underline" href={policy.source_url} rel="noreferrer" target="_blank">{policy.source_id}<ExternalLink className="h-3 w-3" /></a></td>
              <td><span className="mono text-xs text-[var(--mist)]">{policy.coverage_start}</span><p className="mt-1 text-xs text-[var(--fog)]">to {policy.coverage_end}</p></td>
              <td><span className="mono text-sm text-[var(--paper)]">{formatGenAmount(policy.payout_amount_actual || policy.payout_amount)} GEN</span><p className="mt-1 text-xs text-[var(--fog)]">{policy.evidence_id || "Awaiting evidence"}</p></td>
               <td><div className="flex flex-wrap items-center gap-2"><span className="status-pill" data-tone={statusTone(policy.status)}><span className="status-dot" />{policy.status}</span>{evaluations[String(policy.policy_id)] && onShowEvaluation ? <button className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[10px] font-semibold text-[var(--lichen)] hover:border-[var(--lichen)]" onClick={() => onShowEvaluation(policy)} type="button">Detail</button> : null}</div></td>
               <td>{policy.status === "ACTIVE" ? isEvaluationReady(policy) ? <button className="secondary-button min-h-8 px-3 text-xs" disabled={evaluatingPolicyId !== null} onClick={() => void onEvaluate(policy)} type="button">{evaluatingPolicyId === Number(policy.policy_id) ? <><LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Evaluating…</> : <>Evaluate <ArrowRight className="h-3.5 w-3.5" /></>}</button> : <button className="secondary-button min-h-8 cursor-not-allowed px-3 text-xs opacity-45" disabled title={`Evaluate unlocks after ${policy.coverage_end}`} type="button"><LockKeyhole className="h-3.5 w-3.5" /> Evaluate</button> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreateView({ availableCoverage, form, updateForm, onSubmit, isConnected, isOnCorrectNetwork, isContractConfigured, actionInProgress }: { availableCoverage: string; form: PolicyForm; updateForm: (key: keyof PolicyForm, value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; isConnected: boolean; isOnCorrectNetwork: boolean; isContractConfigured: boolean; actionInProgress: boolean }) {
  const [minimumCoverageStart, setMinimumCoverageStart] = useState("");

  useEffect(() => {
    setMinimumCoverageStart(new Date().toISOString().slice(0, 10));
  }, []);

  return (
    <div className="fade-up">
      <span className="eyebrow">Policy studio / new coverage</span>
      <div className="mt-5 flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div><h1 className="section-title max-w-2xl text-5xl sm:text-6xl">Write the terms once. Let the evidence decide.</h1><p className="section-copy mt-5">Create a binary policy with fixed terms. The source and trigger cannot be changed after purchase.</p></div><span className="status-pill" data-tone="positive"><span className="status-dot" />GEN settlement</span></div>
      <div className="mt-10 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <form className="panel p-6 sm:p-8" onSubmit={onSubmit}>
          <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] pb-5"><div><p className="data-label">01 / Coverage terms</p><h2 className="mt-2 text-xl font-semibold tracking-[-0.04em]">Define the observation</h2></div><MapPinned className="h-5 w-5 text-[var(--lichen)]" /></div>
          <div className="mt-7 grid gap-5 sm:grid-cols-2">
            <label className="form-label sm:col-span-2">Peril<select className="form-control" onChange={(event) => { const peril = event.target.value as PolicyForm["peril"]; updateForm("peril", peril); updateForm("threshold", peril === "EARTHQUAKE" ? "6000" : "250"); }} value={form.peril}><option value="DROUGHT">Drought · NASA POWER</option><option value="EARTHQUAKE">Earthquake · USGS Catalog</option></select></label>
            <label className="form-label sm:col-span-2">Location<input className="form-control" onChange={(event) => updateForm("location", event.target.value)} placeholder="Bandung, Indonesia" value={form.location} /></label>
            <label className="form-label">Latitude<input className="form-control mono" onChange={(event) => updateForm("latitude", event.target.value)} placeholder="-6.69" value={form.latitude} /></label>
            <label className="form-label">Longitude<input className="form-control mono" onChange={(event) => updateForm("longitude", event.target.value)} placeholder="107" value={form.longitude} /></label>
            <label className="form-label">Coverage start<input className="form-control" min={minimumCoverageStart || undefined} onChange={(event) => updateForm("coverageStart", event.target.value)} type="date" value={form.coverageStart} /></label>
            <label className="form-label">Coverage end<input className="form-control" onChange={(event) => updateForm("coverageEnd", event.target.value)} type="date" value={form.coverageEnd} /></label>

            <label className="form-label">Threshold<input className="form-control mono" onChange={(event) => updateForm("threshold", event.target.value)} placeholder="250" value={form.threshold} /><span className="text-xs font-normal text-[var(--fog)]">Millimeters for drought · millimagnitude for earthquake</span></label>
            <label className="form-label">Earthquake radius<input className="form-control mono" disabled={form.peril !== "EARTHQUAKE"} onChange={(event) => updateForm("radius", event.target.value)} placeholder="100" value={form.radius} /><span className="text-xs font-normal text-[var(--fog)]">Radius is ignored for drought</span></label>
          </div>
          <div className="mt-8 border-t border-[var(--line)] pt-7"><div className="flex items-center justify-between gap-4"><div><p className="data-label">02 / Capital</p><h2 className="mt-2 text-xl font-semibold tracking-[-0.04em]">Fund the binary payout</h2></div><WalletCards className="h-5 w-5 text-[var(--lichen)]" /></div><div className="mt-7 grid items-stretch gap-5 sm:grid-cols-2"><div className="flex min-h-[6.75rem] flex-col gap-2 rounded-xl border border-[var(--line)] bg-white/[0.02] p-4"><label className="form-label" htmlFor="policy-premium">Premium (GEN)</label><input className="form-control mono" id="policy-premium" inputMode="numeric" min="1" onChange={(event) => updateForm("premium", event.target.value.replace(/[^0-9]/g, ""))} pattern="[0-9]+" step="1" type="text" value={form.premium} /></div><div className="flex min-h-[6.75rem] flex-col gap-2 rounded-xl border border-[var(--line)] bg-white/[0.02] p-4"><label className="form-label" htmlFor="policy-payout">Payout if triggered (GEN)</label><input className="form-control mono" id="policy-payout" inputMode="numeric" min="1" onChange={(event) => updateForm("payout", event.target.value.replace(/[^0-9]/g, ""))} pattern="[0-9]+" step="1" type="text" value={form.payout} /><span className="text-xs font-normal text-[var(--fog)]">Available excess coverage: {availableCoverage} GEN</span></div></div></div>
          {!isContractConfigured ? <div className="mt-6 rounded-xl border border-[rgba(215,139,97,0.32)] bg-[rgba(215,139,97,0.07)] p-4 text-sm text-[var(--copper)]">Set <span className="mono">NEXT_PUBLIC_CONTRACT_ADDRESS</span> before creating a live policy.</div> : null}
          {!isConnected ? <div className="mt-6 rounded-xl border border-[rgba(215,139,97,0.32)] bg-[rgba(215,139,97,0.07)] p-4 text-sm text-[var(--copper)]">Connect a wallet before creating a policy.</div> : null}
          {isConnected && !isOnCorrectNetwork ? <div className="mt-6 rounded-xl border border-[rgba(222,104,89,0.35)] bg-[rgba(222,104,89,0.07)] p-4 text-sm text-[#ed8a76]">Switch MetaMask to the configured GenLayer network before signing.</div> : null}
          <button className="action-button mt-7 w-full" disabled={!isConnected || !isOnCorrectNetwork || !isContractConfigured || actionInProgress} type="submit">Review and create policy <ArrowRight className="h-4 w-4" /></button>
        </form>
        <div className="space-y-4"><div className="panel p-6"><span className="eyebrow">What gets locked</span><div className="mt-6 space-y-5"><div className="flex gap-3"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-[var(--lichen)]" /><div><p className="text-sm font-semibold">Immutable source mapping</p><p className="mt-1 text-sm leading-6 text-[var(--mist)]">DROUGHT always reads NASA POWER. EARTHQUAKE always reads USGS.</p></div></div><div className="flex gap-3"><ScanLine className="mt-0.5 h-4 w-4 shrink-0 text-[var(--glacier)]" /><div><p className="text-sm font-semibold">Binary settlement</p><p className="mt-1 text-sm leading-6 text-[var(--mist)]">The policy pays the fixed amount or zero. There is no discretionary claim review.</p></div></div><div className="flex gap-3"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--copper)]" /><div><p className="text-sm font-semibold">Observation window</p><p className="mt-1 text-sm leading-6 text-[var(--mist)]">Evaluation is only available after the coverage end date.</p></div></div></div></div><div className="panel-soft p-6"><p className="data-label">Settlement path</p><p className="mt-4 text-lg font-semibold tracking-[-0.04em]">Submit → consensus → finalized</p><p className="mt-2 text-sm leading-6 text-[var(--mist)]">A transaction can be accepted before execution is finalized. StrataSure checks the execution result, not just the lifecycle label.</p></div></div>
      </div>
    </div>
  );
}

function HowItWorksView({ contractInfo }: { contractInfo: ContractInfo | null }) {
  return (
    <div className="fade-up"><span className="eyebrow">Protocol anatomy / no black boxes</span><h1 className="section-title mt-5 max-w-3xl text-5xl sm:text-6xl">The payout path should be explainable before you buy.</h1><p className="section-copy mt-6">StrataSure separates facts, consensus, and settlement. That separation is the product—not a footnote.</p><div className="mt-12 grid gap-5 lg:grid-cols-[0.95fr_1.05fr]"><div className="panel p-6 sm:p-8"><div className="relative space-y-9 pl-9"><div className="timeline-line" />{processSteps.map((step, index) => { const Icon = step.icon; return <div className="relative flex gap-5" key={step.title}><div className="timeline-node" /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><span className="step-number">0{index + 1}</span><Icon className="h-4 w-4 text-[var(--lichen)]" /></div><h2 className="mt-2 text-lg font-semibold tracking-[-0.04em]">{step.title}</h2><p className="mt-2 text-sm leading-6 text-[var(--mist)]">{step.copy}</p></div></div>; })}</div></div><div className="space-y-4"><div className="panel p-6"><div className="flex items-center gap-3"><Radio className="h-5 w-5 text-[var(--glacier)]" /><div><p className="data-label">Allowlisted evidence</p><p className="mt-1 text-lg font-semibold">Two sources. No user-supplied URLs.</p></div></div><div className="mt-6 space-y-3">{sourceCards.map((source) => <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-white/[0.02] p-3" key={source.peril}><span className="text-sm text-[var(--mist)]">{source.peril}</span><span className="mono text-xs text-[var(--paper)]">{source.source}</span></div>)}</div></div><div className="panel p-6"><div className="flex items-center gap-3"><ShieldCheck className="h-5 w-5 text-[var(--lichen)]" /><div><p className="data-label">Consensus boundary</p><p className="mt-1 text-lg font-semibold">The contract owns settlement.</p></div></div><p className="mt-5 text-sm leading-6 text-[var(--mist)]">The frontend can prepare inputs and display evidence. It cannot submit a trusted payout decision. The leader result is checked by validators before state changes.</p><div className="mt-5 flex flex-wrap gap-2"><span className="status-pill" data-tone="positive">Decision compared</span><span className="status-pill">Source confirmed</span><span className="status-pill">Payout protected</span></div></div><div className="panel-soft p-6"><div className="flex items-start gap-3"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-[var(--copper)]" /><div><p className="text-sm font-semibold">Current protocol scope</p><p className="mt-1 text-sm leading-6 text-[var(--mist)]">{contractInfo ? `${contractInfo.name} v${contractInfo.version} supports ${contractInfo.perils.join(" and ")}.` : "Two fixed perils, binary payout, and permissionless evaluation."}</p></div></div></div></div></div></div>
  );
}

function ConsensusResult({ evaluation, transactionUrl }: { evaluation: PolicyEvaluation; transactionUrl?: string }) {
  const decisionTone = evaluation.decision === "TRIGGERED" ? "positive" : evaluation.decision === "NOT_TRIGGERED" ? "warning" : "negative";
  return (
    <div className="mt-4 rounded-xl border border-[var(--line-strong)] bg-[rgba(198,237,116,0.04)] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="data-label">Leader + validator consensus</span>
        <span className="status-pill" data-tone={decisionTone}><span className="status-dot" />{evaluation.decision}</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--line)] bg-black/10 p-3"><span className="data-label">Observed</span><p className="mono mt-2 break-all text-sm text-[var(--paper)]">{String(evaluation.observed_value ?? "—")}</p></div>
        <div className="rounded-lg border border-[var(--line)] bg-black/10 p-3"><span className="data-label">Threshold</span><p className="mono mt-2 break-all text-sm text-[var(--paper)]">{String(evaluation.threshold ?? "—")}</p></div>
        <div className="rounded-lg border border-[var(--line)] bg-black/10 p-3"><span className="data-label">Payout</span><p className="mono mt-2 break-all text-sm text-[var(--paper)]">{evaluation.payout_amount ? `${formatGenAmount(evaluation.payout_amount)} GEN` : "0 GEN"}</p></div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs">
        <span className="text-[var(--mist)]">Source: <span className="mono text-[var(--paper)]">{evaluation.source_id ?? "—"}</span></span>
        <span className="text-[var(--mist)]">Evidence: <span className="mono text-[var(--paper)]">{evaluation.evidence_id ?? "—"}</span></span>
      </div>
      <p className="mt-3 break-all mono text-[10px] leading-5 text-[var(--fog)]">Verification ID: {evaluation.verification_id ?? "pending"}</p>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {evaluation.source_url ? <a className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--lichen)] hover:underline" href={evaluation.source_url} rel="noreferrer" target="_blank">Source evidence <ExternalLink className="h-3 w-3" /></a> : null}
        {transactionUrl ? <a className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--lichen)] hover:underline" href={transactionUrl} rel="noreferrer" target="_blank">Completed transaction <ExternalLink className="h-3 w-3" /></a> : null}
      </div>
    </div>
  );
}

function EvaluationDetailModal({ evaluation, onClose }: { evaluation: PolicyEvaluation; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose} role="presentation">
      <div aria-labelledby="evaluation-detail-title" aria-modal="true" className="panel min-h-[72vh] max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6 sm:p-8" onClick={(event) => event.stopPropagation()} role="dialog">
        <div className="flex items-start justify-between gap-5">
          <div><span className="eyebrow">Evaluation detail / consensus record</span><h2 className="section-title mt-4 text-3xl" id="evaluation-detail-title">Policy #{evaluation.policy_id}</h2><p className="mt-2 text-sm text-[var(--mist)]">The leader and validators compared the same source evidence before settlement.</p></div>
          <button aria-label="Close evaluation detail" className="secondary-button h-10 w-10 min-h-0 p-0" onClick={onClose} type="button"><X className="h-4 w-4" /></button>
        </div>
        <ConsensusResult evaluation={evaluation} />
      </div>
    </div>
  );
}

function ActivityView({ activity }: { activity: ActivityItem[] }) {
  return (
    <div className="fade-up"><span className="eyebrow">Transaction ledger / recent activity</span><h1 className="section-title mt-5 text-5xl sm:text-6xl">A clear trail from signature to settlement.</h1><p className="section-copy mt-6">Submitted hashes and receipt state are kept locally across refreshes. Set an explorer URL to turn every hash into a network-level receipt.</p>{activity.length ? <div className="panel mt-10 divide-y divide-[var(--line)]">{activity.map((item) => { const link = explorerUrl(item.hash); return <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6" key={item.id}><div className="flex min-w-0 items-start gap-4"><div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${item.status === "failed" ? "bg-[rgba(222,104,89,0.12)] text-[#ed8a76]" : "bg-[rgba(198,237,116,0.12)] text-[var(--lichen)]"}`}>{item.status === "failed" ? <XCircle className="h-4 w-4" /> : item.status === "submitted" || item.status === "pending_receipt" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}</div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold text-[var(--paper)]">{item.title}</h2><span className="status-pill" data-tone={item.status === "failed" ? "negative" : item.status === "finalized" ? "positive" : "warning"}><span className="status-dot" />{item.status}</span></div><p className="mt-1 text-xs text-[var(--mist)]">{item.error || item.detail}</p>{item.evaluation ? <ConsensusResult evaluation={item.evaluation} transactionUrl={link} /> : null}<p className="mt-2 truncate mono text-[11px] text-[var(--fog)]">{item.hash}</p></div></div><div className="flex items-center gap-3 sm:flex-col sm:items-end"><span className="text-xs text-[var(--fog)]">{new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>{link ? <a className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--lichen)] hover:underline" href={link} target="_blank" rel="noreferrer">Explorer <ExternalLink className="h-3.5 w-3.5" /></a> : <span className="text-[11px] text-[var(--fog)]">Explorer URL not configured</span>}</div></div>; })}</div> : <div className="mt-10"><EmptyState title="No recent transaction activity" copy="When you create or evaluate a policy, StrataSure will keep the transaction hash and settlement state here for this session." /></div>}</div>
  );
}
