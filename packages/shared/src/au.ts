// Australian formats: phone numbers, ABNs, states and postcodes. Used by the web for instant
// feedback and by the API to enforce the same rules.

export const AU_STATES = ['NSW', 'QLD', 'VIC', 'WA', 'SA', 'TAS', 'ACT', 'NT'] as const;
export type AuState = (typeof AU_STATES)[number];

export function isAuState(value: string): value is AuState {
  return AU_STATES.some((state) => state === value);
}

// ── Phone numbers ─────────────────────────────────────────────────────────

/**
 * Normalises a phone number to E.164 (§1.4 duplicate rules).
 * Accepts Australian mobiles and landlines in any common format ("0412 345 678",
 * "+61 412 345 678", "61412345678", "(02) 9876 5432") and already-international
 * numbers ("+64 21 123 4567"). Returns null when it isn't a valid number.
 */
export function normalisePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /[^\d\s()+.-]/.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, '');

  if (trimmed.startsWith('+')) {
    if (!digits.startsWith('61')) return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
    digits = digits.slice(2);
  } else if (digits.startsWith('61') && digits.length === 11) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = digits.slice(1);
  } else {
    return null;
  }
  // "+61 0412 …" — a trunk 0 typed after the country code.
  if (digits.startsWith('0')) digits = digits.slice(1);
  // Mobiles start with 4; landlines with an area code 2, 3, 7 or 8.
  return /^[23478]\d{8}$/.test(digits) ? `+61${digits}` : null;
}

/** For display: "+61412345678" → "0412 345 678", "+61298765432" → "(02) 9876 5432". */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const local = /^\+61(\d{9})$/.exec(e164)?.[1];
  if (!local) return e164;
  if (local.startsWith('4')) return `0${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  return `(0${local.slice(0, 1)}) ${local.slice(1, 5)} ${local.slice(5)}`;
}

// ── ABN ───────────────────────────────────────────────────────────────────

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

/**
 * Checks an ABN with the ATO modulus-89 checksum and returns it as 11 digits.
 * This proves the number is well-formed, not that the business exists or is active —
 * that needs an ABR lookup (not built yet).
 */
export function parseAbn(input: string): { ok: true; abn: string } | { ok: false; error: string } {
  const digits = input.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits)) return { ok: false, error: 'An ABN contains only digits.' };
  if (digits.length !== 11) {
    return { ok: false, error: `An ABN has 11 digits (this has ${String(digits.length)}).` };
  }
  // Subtract 1 from the first digit, weight every digit, and the total must divide by 89.
  const sum = ABN_WEIGHTS.reduce(
    (total, weight, index) => total + (Number(digits[index]) - (index === 0 ? 1 : 0)) * weight,
    0,
  );
  return sum % 89 === 0
    ? { ok: true, abn: digits }
    : { ok: false, error: "That isn't a valid ABN — check for a typo." };
}

/** "51824753556" → "51 824 753 556". */
export function formatAbn(abn: string | null | undefined): string {
  if (!abn) return '';
  return /^\d{11}$/.test(abn)
    ? `${abn.slice(0, 2)} ${abn.slice(2, 5)} ${abn.slice(5, 8)} ${abn.slice(8)}`
    : abn;
}

/** Public ABN Lookup page for a business. */
export function abnLookupUrl(abn: string): string {
  return `https://abr.business.gov.au/ABN/View?abn=${abn}`;
}

// ── Postcodes ─────────────────────────────────────────────────────────────

type Range = [from: number, to: number];

const STATE_RANGES: [AuState, Range[]][] = [
  [
    'ACT',
    [
      [200, 299],
      [2600, 2618],
      [2900, 2920],
    ],
  ],
  [
    'NSW',
    [
      [1000, 2599],
      [2619, 2899],
      [2921, 2999],
    ],
  ],
  [
    'VIC',
    [
      [3000, 3999],
      [8000, 8999],
    ],
  ],
  [
    'QLD',
    [
      [4000, 4999],
      [9000, 9999],
    ],
  ],
  ['SA', [[5000, 5999]]],
  ['WA', [[6000, 6999]]],
  ['TAS', [[7000, 7999]]],
  ['NT', [[800, 999]]],
];

const inRanges = (n: number, ranges: Range[]) => ranges.some(([from, to]) => n >= from && n <= to);

function postcodeNumber(postcode: string | null | undefined): number | null {
  const clean = (postcode ?? '').trim();
  return /^\d{4}$/.test(clean) ? Number(clean) : null;
}

export function isPostcode(value: string): boolean {
  return postcodeNumber(value) !== null;
}

/** The state a postcode belongs to (Australia Post ranges), or null if unknown. */
export function stateForPostcode(postcode: string | null | undefined): AuState | null {
  const n = postcodeNumber(postcode);
  if (n === null) return null;
  return STATE_RANGES.find(([, ranges]) => inRanges(n, ranges))?.[0] ?? null;
}

const METRO_RANGES: Range[] = [
  // Sydney, Campbelltown/Macarthur, Western Sydney, Canberra
  [1000, 2249],
  [2555, 2574],
  [2740, 2786],
  [2600, 2618],
  [2900, 2920],
  // Melbourne
  [3000, 3207],
  [3335, 3341],
  [3427, 3429],
  [3750, 3810],
  [3910, 3920],
  [3926, 3944],
  [3975, 3978],
  [8000, 8999],
  // Brisbane, Gold Coast, Moreton Bay
  [4000, 4299],
  [4500, 4549],
  // Adelaide
  [5000, 5199],
  [5800, 5999],
  // Perth
  [6000, 6199],
  [6800, 6999],
  // Hobart
  [7000, 7099],
  // Darwin
  [800, 832],
];

/**
 * Metro or Regional, by postcode (Australia Post / ABS remoteness, as used by the old app).
 * Values match the `areas` option list. Null when the postcode isn't valid.
 */
export function areaForPostcode(postcode: string | null | undefined): 'Metro' | 'Regional' | null {
  const n = postcodeNumber(postcode);
  if (n === null) return null;
  return inRanges(n, METRO_RANGES) ? 'Metro' : 'Regional';
}

const CITY_RANGES: [string, Range[]][] = [
  [
    'Sydney',
    [
      [1000, 2249],
      [2555, 2574],
      [2740, 2786],
    ],
  ],
  ['Central Coast', [[2250, 2263]]],
  ['Newcastle', [[2280, 2338]]],
  ['Port Macquarie / Coffs Harbour', [[2440, 2470]]],
  ['Byron Bay / Tweed Heads', [[2480, 2490]]],
  ['Wollongong', [[2500, 2534]]],
  [
    'Canberra',
    [
      [2600, 2618],
      [2900, 2920],
    ],
  ],
  ['Wagga Wagga', [[2650, 2660]]],
  ['Bathurst / Orange', [[2795, 2800]]],
  ['Dubbo', [[2830, 2831]]],
  [
    'Melbourne',
    [
      [3000, 3207],
      [3900, 3999],
    ],
  ],
  ['Geelong', [[3211, 3220]]],
  ['Ballarat', [[3350, 3358]]],
  ['Bendigo', [[3550, 3558]]],
  ['Shepparton', [[3630, 3632]]],
  ['Traralgon', [[3840, 3844]]],
  [
    'Brisbane',
    [
      [4000, 4179],
      [4300, 4305],
      [4500, 4549],
    ],
  ],
  ['Gold Coast', [[4208, 4230]]],
  ['Toowoomba', [[4350, 4352]]],
  ['Sunshine Coast', [[4550, 4575]]],
  ['Rockhampton', [[4700, 4702]]],
  ['Mackay', [[4740, 4741]]],
  ['Townsville', [[4810, 4818]]],
  ['Cairns', [[4870, 4879]]],
  ['Adelaide', [[5000, 5199]]],
  ['Mount Gambier', [[5290, 5291]]],
  ['Perth', [[6000, 6199]]],
  ['Mandurah', [[6210, 6211]]],
  ['Bunbury', [[6230, 6231]]],
  ['Hobart', [[7000, 7099]]],
  ['Launceston', [[7250, 7255]]],
  ['Darwin', [[800, 832]]],
  ['Alice Springs', [[870, 872]]],
];

const CAPITALS: Record<AuState, string> = {
  NSW: 'Sydney',
  VIC: 'Melbourne',
  QLD: 'Brisbane',
  WA: 'Perth',
  SA: 'Adelaide',
  TAS: 'Hobart',
  ACT: 'Canberra',
  NT: 'Darwin',
};

/** Nearest big city by postcode; falls back to the state capital, or null if neither is known. */
export function nearestBigCity(
  postcode: string | null | undefined,
  state: string | null | undefined,
): string | null {
  const n = postcodeNumber(postcode);
  if (n !== null) {
    const city = CITY_RANGES.find(([, ranges]) => inRanges(n, ranges))?.[0];
    if (city) return city;
  }
  const resolved = state && isAuState(state) ? state : stateForPostcode(postcode);
  return resolved ? CAPITALS[resolved] : null;
}
