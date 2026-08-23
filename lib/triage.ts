export const TRIAGE_STATUSES = ["untriaged", "recognized", "questioned"] as const;
export type TriageStatus = (typeof TRIAGE_STATUSES)[number];

export function normalizeTriage(value: string | null | undefined): TriageStatus {
  if (value === "recognized" || value === "questioned") return value;
  return "untriaged";
}

export function isTriageStatus(value: unknown): value is TriageStatus {
  return value === "untriaged" || value === "recognized" || value === "questioned";
}
