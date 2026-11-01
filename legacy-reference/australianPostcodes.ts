/**
 * Australian Postcode to Area (Metro vs Regional) Classifier
 * Based on Australia Post, ABS ASGS Remoteness Structure, and Clean Energy Regulator STC guidelines.
 */

export function classifyAustralianPostcode(postcode: string, state?: string): 'Metro' | 'Regional' {
  if (!postcode) return 'Metro';
  
  const clean = postcode.replace(/[^0-9]/g, '');
  const numeric = parseInt(clean, 10);
  if (isNaN(numeric) || numeric === 0) {
    return 'Metro';
  }

  // NSW & ACT (Postcodes 1000 - 2999)
  if (numeric >= 1000 && numeric <= 2999) {
    // ACT (2600-2618, 2900-2920) -> Metro
    if ((numeric >= 2600 && numeric <= 2618) || (numeric >= 2900 && numeric <= 2920)) {
      return 'Metro';
    }
    // Sydney Metro Core & Suburbs
    if (numeric >= 1000 && numeric <= 2249) return 'Metro';
    if (numeric >= 2555 && numeric <= 2574) return 'Metro'; // Campbelltown / Macarthur outer metro
    if (numeric >= 2740 && numeric <= 2786) return 'Metro'; // Penrith / Blacktown / Western Sydney
    // Central Coast, Newcastle, Wollongong and Country NSW -> Regional
    return 'Regional';
  }

  // VIC (Postcodes 3000 - 3999, 8000 - 8999)
  if ((numeric >= 3000 && numeric <= 3999) || (numeric >= 8000 && numeric <= 8999)) {
    // Melbourne Metro
    if (numeric >= 3000 && numeric <= 3207) return 'Metro';
    if (numeric >= 3335 && numeric <= 3341) return 'Metro';
    if (numeric >= 3427 && numeric <= 3429) return 'Metro';
    if (numeric >= 3750 && numeric <= 3810) return 'Metro';
    if (numeric >= 3910 && numeric <= 3920) return 'Metro';
    if (numeric >= 3926 && numeric <= 3944) return 'Metro';
    if (numeric >= 3975 && numeric <= 3978) return 'Metro';
    if (numeric >= 8000 && numeric <= 8999) return 'Metro';
    return 'Regional';
  }

  // QLD (Postcodes 4000 - 4999, 9000 - 9999)
  if ((numeric >= 4000 && numeric <= 4999) || (numeric >= 9000 && numeric <= 9999)) {
    // Brisbane Metro & Gold Coast & Moreton Bay
    if (numeric >= 4000 && numeric <= 4299) return 'Metro';
    if (numeric >= 4500 && numeric <= 4549) return 'Metro';
    return 'Regional';
  }

  // SA (Postcodes 5000 - 5999)
  if (numeric >= 5000 && numeric <= 5999) {
    // Adelaide Metro
    if (numeric >= 5000 && numeric <= 5199) return 'Metro';
    if (numeric >= 5800 && numeric <= 5999) return 'Metro';
    return 'Regional';
  }

  // WA (Postcodes 6000 - 6999)
  if (numeric >= 6000 && numeric <= 6999) {
    // Perth Metro
    if (numeric >= 6000 && numeric <= 6199) return 'Metro';
    if (numeric >= 6800 && numeric <= 6999) return 'Metro';
    return 'Regional';
  }

  // TAS (Postcodes 7000 - 7999)
  if (numeric >= 7000 && numeric <= 7999) {
    // Hobart Metro
    if (numeric >= 7000 && numeric <= 7099) return 'Metro';
    return 'Regional';
  }

  // NT (Postcodes 0800 - 0899)
  if (numeric >= 800 && numeric <= 899) {
    // Darwin Metro
    if (numeric >= 800 && numeric <= 832) return 'Metro';
    return 'Regional';
  }

  return 'Metro';
}

/**
 * Auto-detects the Nearest Big City based on suburb, postcode, and state.
 */
export function getNearestBigCity(suburb?: string, postcode?: string, state?: string): string {
  const subLower = (suburb || '').trim().toLowerCase();
  const pcClean = (postcode || '').replace(/[^0-9]/g, '');
  const numeric = parseInt(pcClean, 10);
  const stUpper = (state || '').trim().toUpperCase();

  // Explicit suburb mappings
  if (subLower.includes('sydney') || subLower.includes('parramatta') || subLower.includes('penrith') || subLower.includes('blacktown') || subLower.includes('cronulla') || subLower.includes('castle hill') || subLower.includes('strathfield') || subLower.includes('chatswood') || subLower.includes('liverpool') || subLower.includes('manly')) {
    return 'Sydney';
  }
  if (subLower.includes('newcastle') || subLower.includes('maitland') || subLower.includes('cessnock')) {
    return 'Newcastle';
  }
  if (subLower.includes('wollongong') || subLower.includes('shellharbour') || subLower.includes('kiama')) {
    return 'Wollongong';
  }
  if (subLower.includes('gosford') || subLower.includes('wyong') || subLower.includes('terrigal') || subLower.includes('central coast')) {
    return 'Central Coast';
  }
  if (subLower.includes('melbourne') || subLower.includes('st kilda') || subLower.includes('richmond') || subLower.includes('frankston') || subLower.includes('dandenong') || subLower.includes('werribee')) {
    return 'Melbourne';
  }
  if (subLower.includes('geelong') || subLower.includes('torquay')) {
    return 'Geelong';
  }
  if (subLower.includes('ballarat')) return 'Ballarat';
  if (subLower.includes('bendigo')) return 'Bendigo';
  if (subLower.includes('brisbane') || subLower.includes('sunnybank') || subLower.includes('chermside') || subLower.includes('ipswich') || subLower.includes('logan')) {
    return 'Brisbane';
  }
  if (subLower.includes('gold coast') || subLower.includes('surfers paradise') || subLower.includes('southport') || subLower.includes('robina') || subLower.includes('burleigh')) {
    return 'Gold Coast';
  }
  if (subLower.includes('sunshine coast') || subLower.includes('maroochydore') || subLower.includes('caloundra') || subLower.includes('noosa')) {
    return 'Sunshine Coast';
  }
  if (subLower.includes('toowoomba')) return 'Toowoomba';
  if (subLower.includes('townsville')) return 'Townsville';
  if (subLower.includes('cairns')) return 'Cairns';
  if (subLower.includes('perth') || subLower.includes('fremantle') || subLower.includes('joondalup') || subLower.includes('mandurah')) {
    return 'Perth';
  }
  if (subLower.includes('adelaide') || subLower.includes('glenelg') || subLower.includes('marion')) {
    return 'Adelaide';
  }
  if (subLower.includes('hobart')) return 'Hobart';
  if (subLower.includes('launceston')) return 'Launceston';
  if (subLower.includes('canberra')) return 'Canberra';
  if (subLower.includes('darwin')) return 'Darwin';

  // Postcode numeric ranges
  if (!isNaN(numeric) && numeric > 0) {
    if (numeric >= 1000 && numeric <= 2249) return 'Sydney';
    if (numeric >= 2250 && numeric <= 2263) return 'Central Coast';
    if (numeric >= 2280 && numeric <= 2338) return 'Newcastle';
    if (numeric >= 2440 && numeric <= 2470) return 'Port Macquarie / Coffs Harbour';
    if (numeric >= 2480 && numeric <= 2490) return 'Byron Bay / Tweed Heads';
    if (numeric >= 2500 && numeric <= 2534) return 'Wollongong';
    if (numeric >= 2555 && numeric <= 2574) return 'Sydney';
    if (numeric >= 2600 && numeric <= 2618) return 'Canberra';
    if (numeric >= 2650 && numeric <= 2660) return 'Wagga Wagga';
    if (numeric >= 2740 && numeric <= 2786) return 'Sydney';
    if (numeric >= 2795 && numeric <= 2800) return 'Bathurst / Orange';
    if (numeric >= 2830 && numeric <= 2831) return 'Dubbo';
    if (numeric >= 2900 && numeric <= 2920) return 'Canberra';

    if (numeric >= 3000 && numeric <= 3207) return 'Melbourne';
    if (numeric >= 3211 && numeric <= 3220) return 'Geelong';
    if (numeric >= 3350 && numeric <= 3358) return 'Ballarat';
    if (numeric >= 3550 && numeric <= 3558) return 'Bendigo';
    if (numeric >= 3630 && numeric <= 3632) return 'Shepparton';
    if (numeric >= 3840 && numeric <= 3844) return 'Traralgon';
    if (numeric >= 3900 && numeric <= 3999) return 'Melbourne';

    if (numeric >= 4000 && numeric <= 4179) return 'Brisbane';
    if (numeric >= 4208 && numeric <= 4230) return 'Gold Coast';
    if (numeric >= 4300 && numeric <= 4305) return 'Brisbane';
    if (numeric >= 4350 && numeric <= 4352) return 'Toowoomba';
    if (numeric >= 4500 && numeric <= 4549) return 'Brisbane';
    if (numeric >= 4550 && numeric <= 4575) return 'Sunshine Coast';
    if (numeric >= 4700 && numeric <= 4702) return 'Rockhampton';
    if (numeric >= 4740 && numeric <= 4741) return 'Mackay';
    if (numeric >= 4810 && numeric <= 4818) return 'Townsville';
    if (numeric >= 4870 && numeric <= 4879) return 'Cairns';

    if (numeric >= 5000 && numeric <= 5199) return 'Adelaide';
    if (numeric >= 5290 && numeric <= 5291) return 'Mount Gambier';

    if (numeric >= 6000 && numeric <= 6199) return 'Perth';
    if (numeric >= 6210 && numeric <= 6211) return 'Mandurah';
    if (numeric >= 6230 && numeric <= 6231) return 'Bunbury';

    if (numeric >= 7000 && numeric <= 7099) return 'Hobart';
    if (numeric >= 7250 && numeric <= 7255) return 'Launceston';

    if (numeric >= 800 && numeric <= 832) return 'Darwin';
    if (numeric >= 870 && numeric <= 872) return 'Alice Springs';
  }

  // Fallback by state capital
  switch (stUpper) {
    case 'NSW': return 'Sydney';
    case 'VIC': return 'Melbourne';
    case 'QLD': return 'Brisbane';
    case 'WA': return 'Perth';
    case 'SA': return 'Adelaide';
    case 'TAS': return 'Hobart';
    case 'ACT': return 'Canberra';
    case 'NT': return 'Darwin';
    default: return 'Sydney';
  }
}

/**
 * Format Australian Mobile Phone number:
 * - If starts with '4' and '0' is missing, adds '0' prefix (e.g. 412345678 -> 0412 345 678)
 * - Formats as '04XX XXX XXX'
 */
export function formatAustralianMobile(value: string): string {
  if (!value) return '';

  let cleaned = value.trim();

  // If starts with +61, convert to 0
  if (cleaned.startsWith('+61')) {
    cleaned = '0' + cleaned.slice(3).replace(/\s+/g, '');
  } else if (cleaned.startsWith('61') && cleaned.length >= 10) {
    cleaned = '0' + cleaned.slice(2).replace(/\s+/g, '');
  }

  // Keep only numbers
  const digitsOnly = cleaned.replace(/[^0-9]/g, '');
  if (!digitsOnly) return '';

  // If number starts with 4 and lacks 0, prepend 0
  let normalized = digitsOnly;
  if (normalized.startsWith('4')) {
    normalized = '0' + normalized;
  }

  // Format as 04XX XXX XXX (or standard landline 02 XXXX XXXX if applicable)
  if (normalized.startsWith('04')) {
    const p1 = normalized.slice(0, 4);
    const p2 = normalized.slice(4, 7);
    const p3 = normalized.slice(7, 10);
    const extra = normalized.slice(10);
    if (p3) return `${p1} ${p2} ${p3}${extra ? ' ' + extra : ''}`;
    if (p2) return `${p1} ${p2}`;
    return p1;
  } else if (normalized.length === 10) {
    // 02 8311 4920 format
    return `${normalized.slice(0, 2)} ${normalized.slice(2, 6)} ${normalized.slice(6, 10)}`;
  }

  return value;
}

/**
 * Validate multiple email addresses (comma, semicolon, or space separated).
 * Returns validation status and list of emails.
 */
export function validateMultipleEmails(rawInput: string): {
  isValid: boolean;
  emails: string[];
  invalidEmails: string[];
} {
  if (!rawInput || !rawInput.trim()) {
    return { isValid: true, emails: [], invalidEmails: [] };
  }

  const parts = rawInput
    .split(/[,;\s]+/)
    .map(p => p.trim())
    .filter(Boolean);

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const validEmails: string[] = [];
  const invalidEmails: string[] = [];

  for (const email of parts) {
    if (emailRegex.test(email)) {
      validEmails.push(email);
    } else {
      invalidEmails.push(email);
    }
  }

  return {
    isValid: invalidEmails.length === 0,
    emails: validEmails,
    invalidEmails
  };
}

/**
 * Formats a numeric value or string as Accounts style AUD Currency ($XX,XXX.XX)
 */
export function formatAudAccounts(val: number | string | undefined | null): string {
  if (val === undefined || val === null || val === '') return '';
  const num = typeof val === 'string' ? parseFloat(val.replace(/[^0-9.-]/g, '')) : val;
  if (isNaN(num)) return '';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
}

/**
 * Formats a numeric value or string as Accounts style AUD number without the currency symbol ($)
 * Ideal for fields that already display a '$' icon prefix to avoid duplicate symbols.
 * e.g. 10500 -> "10,500.00"
 */
export function formatAudNumber(val: number | string | undefined | null): string {
  if (val === undefined || val === null || val === '') return '';
  const num = typeof val === 'string' ? parseFloat(val.replace(/[^0-9.-]/g, '')) : val;
  if (isNaN(num)) return '';
  return new Intl.NumberFormat('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
}

/**
 * Strips any leading '$' signs, spaces, and commas, returning clean display number string
 * e.g. "$10,500.00" -> "10,500.00"
 */
export function stripDollarSign(val: string | number | undefined | null): string {
  if (val === undefined || val === null) return '';
  return String(val).replace(/^\s*\$\s*/, '').trim();
}

/**
 * Parses an AUD accounts string back into a float number
 */
export function parseAudAccounts(val: string): number {
  if (!val) return 0;
  const cleaned = val.replace(/[^0-9.-]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

export interface AustralianAddressPreset {
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  area: 'Metro' | 'Regional';
  nearestBigCity: string;
}

/**
 * Sample Australian Verified Address Autocomplete Directory
 */
export const AUSTRALIAN_ADDRESS_DATABASE: AustralianAddressPreset[] = [
  { address: '142 George Street', suburb: 'The Rocks', state: 'NSW', postcode: '2000', area: 'Metro', nearestBigCity: 'Sydney' },
  { address: '55 Pitt Street', suburb: 'Sydney', state: 'NSW', postcode: '2000', area: 'Metro', nearestBigCity: 'Sydney' },
  { address: '28 Ocean Beach Road', suburb: 'Manly', state: 'NSW', postcode: '2095', area: 'Metro', nearestBigCity: 'Sydney' },
  { address: '18 Victoria Avenue', suburb: 'Chatswood', state: 'NSW', postcode: '2067', area: 'Metro', nearestBigCity: 'Sydney' },
  { address: '492 Church Street', suburb: 'Parramatta', state: 'NSW', postcode: '2150', area: 'Metro', nearestBigCity: 'Sydney' },
  { address: '12 Castle Street', suburb: 'Castle Hill', state: 'NSW', postcode: '2154', area: 'Metro', nearestBigCity: 'Sydney' },
  { address: '88 The Mall', suburb: 'Strathfield', state: 'NSW', postcode: '2135', area: 'Metro', nearestBigCity: 'Sydney' },
  { address: '30 Gerrale Street', suburb: 'Cronulla', state: 'NSW', postcode: '2230', area: 'Metro', nearestBigCity: 'Sydney' },
  { address: '74 High Street', suburb: 'Penrith', state: 'NSW', postcode: '2750', area: 'Metro', nearestBigCity: 'Sydney' },
  { address: '105 Hunter Street', suburb: 'Newcastle', state: 'NSW', postcode: '2300', area: 'Regional', nearestBigCity: 'Newcastle' },
  { address: '42 Crown Street', suburb: 'Wollongong', state: 'NSW', postcode: '2500', area: 'Regional', nearestBigCity: 'Wollongong' },
  { address: '15 Mann Street', suburb: 'Gosford', state: 'NSW', postcode: '2250', area: 'Regional', nearestBigCity: 'Central Coast' },
  { address: '230 Collins Street', suburb: 'Melbourne', state: 'VIC', postcode: '3000', area: 'Metro', nearestBigCity: 'Melbourne' },
  { address: '45 Chapel Street', suburb: 'South Yarra', state: 'VIC', postcode: '3141', area: 'Metro', nearestBigCity: 'Melbourne' },
  { address: '82 Moorabool Street', suburb: 'Geelong', state: 'VIC', postcode: '3220', area: 'Regional', nearestBigCity: 'Geelong' },
  { address: '200 Queen Street', suburb: 'Brisbane City', state: 'QLD', postcode: '4000', area: 'Metro', nearestBigCity: 'Brisbane' },
  { address: '35 Mains Road', suburb: 'Sunnybank', state: 'QLD', postcode: '4109', area: 'Metro', nearestBigCity: 'Brisbane' },
  { address: '18 Cavill Avenue', suburb: 'Surfers Paradise', state: 'QLD', postcode: '4217', area: 'Metro', nearestBigCity: 'Gold Coast' },
  { address: '50 Brisbane Street', suburb: 'Ipswich', state: 'QLD', postcode: '4305', area: 'Metro', nearestBigCity: 'Brisbane' },
  { address: '12 Ocean Street', suburb: 'Maroochydore', state: 'QLD', postcode: '4558', area: 'Regional', nearestBigCity: 'Sunshine Coast' },
  { address: '100 St Georges Terrace', suburb: 'Perth', state: 'WA', postcode: '6000', area: 'Metro', nearestBigCity: 'Perth' },
  { address: '85 King William Street', suburb: 'Adelaide', state: 'SA', postcode: '5000', area: 'Metro', nearestBigCity: 'Adelaide' },
  { address: '40 Elizabeth Street', suburb: 'Hobart', state: 'TAS', postcode: '7000', area: 'Metro', nearestBigCity: 'Hobart' },
  { address: '68 Mitchell Street', suburb: 'Darwin City', state: 'NT', postcode: '0800', area: 'Metro', nearestBigCity: 'Darwin' },
  { address: '12 London Circuit', suburb: 'Canberra', state: 'ACT', postcode: '2601', area: 'Metro', nearestBigCity: 'Canberra' }
];

const STREET_TYPES = '(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Circuit|Cct|Court|Ct|Place|Pl|Lane|Ln|Boulevard|Blvd|Way|Close|Cl|Parade|Pde|Terrace|Tce|Crescent|Cres|Highway|Hwy|Grove|Gr|Rise|Track|Trk|Esplanade|Esp|Loop|Mews)';

/**
 * CRITICAL RULE IMPLEMENTATION:
 * Extracts strictly the street address line from an Australian address string,
 * removing any concatenated Suburb, State (NSW, QLD, VIC, ACT, SA, WA, TAS, NT),
 * or Post Code. Ensures the street line is clean and never concatenated.
 */
export function extractStreetAddressOnly(
  rawAddress?: string | null,
  knownSuburb?: string | null,
  knownState?: string | null,
  knownPostcode?: string | null
): string {
  if (!rawAddress) return '';
  let clean = String(rawAddress).trim();

  const parts = clean.split(',').map(p => p.trim()).filter(Boolean);

  if (parts.length > 1) {
    const streetRegex = new RegExp(`\\b${STREET_TYPES}\\b`, 'i');
    if (streetRegex.test(parts[0])) {
      clean = parts[0];
    } else if (/^(?:unit|apt|apartment|suite|level|lot|flat|shop)\s*[\w/-]+$/i.test(parts[0]) && parts.length > 1) {
      clean = `${parts[0]}, ${parts[1]}`;
    } else {
      clean = parts[0];
    }
  } else {
    clean = clean.replace(/\s+\d{4}\s*$/, '');
    clean = clean.replace(/\s+(?:NSW|QLD|VIC|ACT|SA|WA|TAS|NT)\s*$/i, '');
    if (knownSuburb && knownSuburb.trim().length > 1) {
      const sub = knownSuburb.trim();
      const subIdx = clean.toLowerCase().lastIndexOf(sub.toLowerCase());
      if (subIdx > 0) {
        clean = clean.substring(0, subIdx).trim();
      }
    }
    if (knownPostcode && knownPostcode.trim().length > 0) {
      const pcIdx = clean.lastIndexOf(knownPostcode.trim());
      if (pcIdx > 0) {
        clean = clean.substring(0, pcIdx).trim();
      }
    }
    if (knownState && knownState.trim().length > 0) {
      const stIdx = clean.toUpperCase().lastIndexOf(knownState.trim().toUpperCase());
      if (stIdx > 0 && stIdx === clean.length - knownState.trim().length) {
        clean = clean.substring(0, stIdx).trim();
      }
    }
  }

  clean = clean.replace(/[\s,-]+$/, '').trim();
  return clean || rawAddress.trim();
}

