import { z } from "zod";

export const IntentSchema = z.object({
  action: z.literal("transfer"),
  beneficiary: z.string().min(1).max(120),
  amount: z.number().positive().finite(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  invoice_id: z.string().max(40).nullable(),
  reference: z.string().max(140),
  reason: z.enum(["payment_to_supplier", "professional_business_services", "travel", "others"]),
  planner_notes: z.string().max(500).optional(),
});
export type Intent = z.infer<typeof IntentSchema>;

export type Corridor = { currency: string; country: string; method: string };
export type Beneficiary = Corridor & { key: string; aliases: string[]; airwallexId: string };
export type Invoice = { id: string; beneficiary: string; amount: number; currency: string; status: "open" | "paid" };
export type Policy = {
  version: number;
  perTxLimit: Record<string, number>;
  dailyLimit: Record<string, number>;
  humanApprovalAbove: Record<string, number>;
  maxTxPerHour: number;
  duplicateWindowMinutes: number;
  supportedCorridors: Corridor[];
  blockedCurrencies: string[];
  beneficiaries: Beneficiary[];
  invoices: Invoice[];
  requireInvoice: boolean;
  injectionPatterns: string[];
};

export type LedgerEntry = {
  request_id: string;
  fingerprint: string;
  beneficiary: string;
  amount: number;
  currency: string;
  invoice_id: string | null;
  at: string;
  airwallex_id?: string;
};

export type Check = { id: string; pass: boolean; detail: string };
export type StageStatus = "pass" | "fail" | "skip" | "pending";
export type Stage = { name: "planner" | "checks" | "verifier" | "approval" | "execute"; status: StageStatus; detail: string; data?: unknown; ms?: number };
export type RunResult = {
  run_id: string;
  request_id: string;
  request: string;
  outcome: "executed" | "blocked" | "pending_approval" | "dry_run";
  reason: string;
  stages: Stage[];
  intent?: Intent;
  transfer?: { id: string; status: string; short_reference_id?: string; beneficiary_id?: string };
};
