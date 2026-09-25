export interface Policy {
  policy_id: string;
  insured: string;
  peril: "DROUGHT" | "EARTHQUAKE";
  location: string;
  latitude_microdegrees: number;
  longitude_microdegrees: number;
  coverage_start: string;
  coverage_end: string;
  source_id: string;
  source_policy_version: string;
  threshold: string;
  threshold_unit: "MILLIMETERS" | "MILLIMAGNITUDE";
  radius_km: string;
  premium: string;
  payout_amount: string;
  payout_amount_actual: string;
  status: "ACTIVE" | "TRIGGERED" | "NOT_TRIGGERED" | "EXPIRED";
  evaluation_timestamp: string;
  evidence_timestamp: string;
  evidence_id: string;
  observed_value: string;
  payout_processed: boolean;
  source_url: string;
  terms_commitment: string;
}

export interface PolicyEvaluation {
  policy_id: string;
  decision: "TRIGGERED" | "NOT_TRIGGERED" | "INSUFFICIENT_EVIDENCE";
  observed_value?: string;
  threshold?: string;
  payout_amount?: string;
  evidence_timestamp?: string;
  source_id?: string;
  source_confirmed?: boolean;
  evidence_id?: string;
  source_policy_version?: string;
  source_url?: string;
  evidence_commitment?: string;
  terms_commitment?: string;
  verification_id?: string;
}

export interface ContractInfo {
  name: string;
  version: string;
  payout_asset: string;
  evaluation_access: "permissionless" | "keeper";
  perils: string[];
}

export interface RiskSummary {
  pool_balance: string;
  total_coverage: string;
  total_premiums: string;
  policy_count: string;
}
