export const PRACTICE_OPTIONS = [
  "General Transactions",
  "Corporate",
  "Finance",
  "Litigation",
  "Real Estate",
  "Tax",
  "Employment",
  "IP",
  "Competition",
  "Tech Transactions",
  "Application Finance",
  "EC/VC",
  "Private Equity",
  "Private Credit",
  "ECM",
  "DCM",
  "Lev Fin",
  "Arbitration",
  "Others",
] as const;

export type Practice = (typeof PRACTICE_OPTIONS)[number];
