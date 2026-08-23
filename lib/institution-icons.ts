/** Static institution icons under /institution-icons (self-hosted, not Plaid). */

const RULES: { src: string; test: (name: string) => boolean }[] = [
  { src: "/institution-icons/amex.png", test: (n) => n.includes("american express") || n.includes("amex") },
  { src: "/institution-icons/boa.png", test: (n) => n.includes("bank of america") },
  { src: "/institution-icons/capital-one.png", test: (n) => n.includes("capital one") },
  { src: "/institution-icons/chase.png", test: (n) => n.includes("chase") },
  { src: "/institution-icons/citi.png", test: (n) => n.includes("citi") },
  { src: "/institution-icons/schwab.png", test: (n) => n.includes("schwab") },
  { src: "/institution-icons/usbank.png", test: (n) => n.includes("u.s. bank") || n.includes("us bank") || n === "usbank" },
];

export function resolveInstitutionIcon(institutionName: string | null | undefined): string | null {
  if (!institutionName) return null;
  const name = institutionName.toLowerCase();
  for (const rule of RULES) {
    if (rule.test(name)) return rule.src;
  }
  return null;
}
