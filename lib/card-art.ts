/** Static credit-card face art under /card-art. Matched by mask override, then Plaid names. */

type CardArt = { src: string; label: string };

type CardArtRule = {
  src: string;
  label: string;
  /** Match against lowercase name + officialName + institutionName. First hit wins. */
  test: (haystack: string) => boolean;
};

/**
 * Optional last-4 → art overrides when Plaid names collide (e.g. several Chase
 * cards labeled "Ultimate Rewards®"). Leave empty in the open-source tree;
 * add your own masks locally if needed — never commit real card last-4s.
 */
const MASK_OVERRIDES: Record<string, CardArt> = {};

const RULES: CardArtRule[] = [
  {
    src: "/card-art/amex-hilton-aspire.png",
    label: "Hilton Honors Aspire",
    test: (h) => h.includes("hilton") && h.includes("aspire"),
  },
  {
    src: "/card-art/amex-business-platinum.png",
    label: "Business Platinum",
    test: (h) => h.includes("business platinum"),
  },
  {
    src: "/card-art/amex-gold.png",
    label: "American Express Gold",
    test: (h) => h.includes("gold card") || (h.includes("american express") && h.includes("gold")),
  },
  {
    src: "/card-art/amex-platinum.png",
    label: "Platinum Card",
    test: (h) => h.includes("platinum card") || (h.includes("american express") && h.includes("platinum")),
  },
  {
    src: "/card-art/boa-atmos-ascent.png",
    label: "Atmos Rewards Ascent",
    test: (h) => h.includes("atmos") || h.includes("ascent"),
  },
  {
    src: "/card-art/capital-one-venture-x.png",
    label: "Venture X",
    test: (h) => h.includes("venture x"),
  },
  {
    src: "/card-art/chase-world-of-hyatt.png",
    label: "World of Hyatt",
    test: (h) => h.includes("hyatt"),
  },
  {
    src: "/card-art/chase-freedom-unlimited.png",
    label: "Freedom Unlimited",
    test: (h) => h.includes("freedom unlimited"),
  },
  {
    src: "/card-art/chase-sapphire-preferred.png",
    label: "Sapphire Preferred",
    test: (h) => h.includes("sapphire preferred"),
  },
  {
    src: "/card-art/citi-aadvantage-platinum-select.png",
    label: "AAdvantage Platinum Select",
    test: (h) => h.includes("aadvantage") || (h.includes("platinum select") && h.includes("citi")),
  },
];

export function resolveCardArt(account: {
  name: string;
  officialName?: string | null;
  institutionName?: string | null;
  mask?: string | null;
  type?: string | null;
}): CardArt | null {
  if (account.type && account.type !== "credit") return null;
  if (account.mask && MASK_OVERRIDES[account.mask]) return MASK_OVERRIDES[account.mask];
  const haystack = [account.name, account.officialName, account.institutionName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  for (const rule of RULES) {
    if (rule.test(haystack)) return { src: rule.src, label: rule.label };
  }
  return null;
}
