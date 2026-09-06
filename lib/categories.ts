export const PLAID_PRIMARY_CATEGORIES = [
  "INCOME",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
  "BANK_FEES",
  "ENTERTAINMENT",
  "FOOD_AND_DRINK",
  "GENERAL_MERCHANDISE",
  "HOME_IMPROVEMENT",
  "MEDICAL",
  "PERSONAL_CARE",
  "GENERAL_SERVICES",
  "GOVERNMENT_AND_NON_PROFIT",
  "TRANSPORTATION",
  "TRAVEL",
  "RENT_AND_UTILITIES",
  "CREDIT_CARD_PAYMENT",
  "INVESTMENT",
] as const;

export type PlaidPrimaryCategory = (typeof PLAID_PRIMARY_CATEGORIES)[number];

export function isPlaidPrimaryCategory(value: unknown): value is PlaidPrimaryCategory {
  return typeof value === "string" && (PLAID_PRIMARY_CATEGORIES as readonly string[]).includes(value);
}
