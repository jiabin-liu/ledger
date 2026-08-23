/** Amex institution name match for last-5 display override. */
export function isAmexInstitution(institutionName: string | null | undefined): boolean {
  return /american express|amex/i.test(institutionName ?? "");
}

export function accountDisplayMask(account: {
  displayMask?: string | null;
  mask?: string | null;
}): string | null {
  return account.displayMask ?? account.mask ?? null;
}

/** Format as •••• 1234 or ••••• 12345 depending on digit length. */
export function formatAccountMask(account: {
  displayMask?: string | null;
  mask?: string | null;
}): string {
  const digits = accountDisplayMask(account);
  if (!digits) return "•••• —";
  const bullets = "•".repeat(Math.max(digits.length, 4));
  return `${bullets} ${digits}`;
}
