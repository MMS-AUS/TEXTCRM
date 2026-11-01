/**
 * Meta Conversions API (CAPI) PII Normalization and SHA-256 Hashing Utility
 * Complies strictly with Meta Graph API v25.0 Conversions API specs.
 *
 * All Personally Identifiable Information (PII) must be normalized and SHA-256
 * hashed before transmission to achieve the highest Event Match Quality (EMQ).
 */

import crypto from 'crypto';

/**
 * Computes SHA-256 hash in hexadecimal format.
 * Uses Node.js crypto module with browser-safe fallback.
 */
export function sha256(value: string): string {
  if (!value) return '';
  if (typeof crypto !== 'undefined' && crypto.createHash) {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
  }
  // Browser fallback for synchronous hashing
  return jsSha256(value);
}

/**
 * Pure JavaScript SHA-256 fallback for client-side environments
 */
function jsSha256(ascii: string): string {
  function rightRotate(value: number, amount: number) {
    return (value >>> amount) | (value << (32 - amount));
  }

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let lengthProperty = 'length';
  let i = 0, j = 0;
  let result = '';

  const words: number[] = [];
  const asciiBitLength = ascii[lengthProperty] * 8;

  let hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  let compositeClearHex = '';
  for (i = 0; i < ascii[lengthProperty]; i++) {
    const code = ascii.charCodeAt(i);
    words[i >> 2] |= (code & 0xff) << (24 - (i % 4) * 8);
  }

  words[asciiBitLength >> 5] |= 0x80 << (24 - (asciiBitLength % 32));
  words[(((asciiBitLength + 64) >> 9) << 4) + 15] = asciiBitLength;

  for (i = 0; i < words[lengthProperty]; i += 16) {
    const w = words.slice(i, i + 16);
    const oldHash = hash.slice(0);

    for (j = 0; j < 64; j++) {
      let w15 = w[j - 2], w2 = w[j - 15];
      let a = hash[0], e = hash[4];
      let temp1 = hash[7]
        + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & hash[5]) ^ ((~e) & hash[6]))
        + k[j]
        + (w[j] = (j < 16) ? (w[j] || 0) : (
          (w[j - 16] || 0)
          + (rightRotate(w15, 17) ^ rightRotate(w15, 19) ^ (w15 >>> 10))
          + (w[j - 7] || 0)
          + (rightRotate(w2, 7) ^ rightRotate(w2, 18) ^ (w2 >>> 3))
        ) | 0);
      let temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
        + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

      hash = [(temp1 + temp2) | 0, a, hash[1], hash[2], (hash[3] + temp1) | 0, hash[4], hash[5], hash[6]];
    }

    for (j = 0; j < 8; j++) {
      hash[j] = (hash[j] + oldHash[j]) | 0;
    }
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j >= 0; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

/**
 * 1. Email (em):
 * Trim leading/trailing whitespace, convert to lowercase, and SHA-256 hash.
 * Example: "Jane.Doe@Example.com " -> "jane.doe@example.com"
 */
export function hashEmail(email?: string | null): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) return null;
  return sha256(normalized);
}

/**
 * 2. Phone (ph):
 * Strip all non-numeric characters (including + sign or dashes), ensure it includes country code,
 * and SHA-256 hash.
 * E.g., for Australian numbers:
 * "0412 884 910" -> "61412884910"
 * "+61 412 884 910" -> "61412884910"
 */
export function hashPhone(phone?: string | null, defaultCountryCode = '61'): string | null {
  if (!phone) return null;
  // Remove non-digits
  let digits = phone.replace(/[^0-9]/g, '');
  if (!digits) return null;

  // If starts with 0 and 10 digits (Australian mobile/landline)
  if (digits.startsWith('0') && digits.length === 10) {
    digits = defaultCountryCode + digits.slice(1);
  } else if (!digits.startsWith(defaultCountryCode) && digits.length === 9) {
    digits = defaultCountryCode + digits;
  }

  return sha256(digits);
}

/**
 * 3. Names (fn, ln):
 * Convert to lowercase, trim, and remove all special characters (punctuation, symbols).
 */
export function hashName(name?: string | null): string | null {
  if (!name) return null;
  // Keep only alphanumeric and whitespace, trim and lowercase
  const cleaned = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/gi, '')
    .replace(/\s+/g, ' ');
  if (!cleaned) return null;
  return sha256(cleaned);
}

/**
 * Splits full name into first and last name and hashes each.
 */
export function hashFullName(fullName?: string | null): { fn: string | null; ln: string | null } {
  if (!fullName) return { fn: null, ln: null };
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0] || '';
  const last = parts.slice(1).join(' ') || '';
  return {
    fn: hashName(first),
    ln: hashName(last)
  };
}

/**
 * 4. City (ct):
 * Convert to lowercase and remove spaces.
 * Example: "Sydney South" -> "sydneysouth"
 */
export function hashCity(city?: string | null): string | null {
  if (!city) return null;
  const cleaned = city.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!cleaned) return null;
  return sha256(cleaned);
}

/**
 * 5. State (st):
 * Format as a two-letter lowercase string.
 * Example: "New South Wales" or "NSW" -> "ns" (or standard 2-letter state abbreviation)
 */
export function hashState(state?: string | null): string | null {
  if (!state) return null;
  const s = state.trim().toUpperCase();
  let code = '';
  if (s === 'NSW' || s.includes('SOUTH WALES')) code = 'ns';
  else if (s === 'QLD' || s.includes('QUEENSLAND')) code = 'ql';
  else if (s === 'VIC' || s.includes('VICTORIA')) code = 'vi';
  else if (s === 'SA' || s.includes('SOUTH AUSTRALIA')) code = 'sa';
  else if (s === 'WA' || s.includes('WESTERN AUSTRALIA')) code = 'wa';
  else if (s === 'TAS' || s.includes('TASMANIA')) code = 'ts';
  else if (s === 'ACT' || s.includes('CAPITAL TERRITORY')) code = 'ct';
  else if (s === 'NT' || s.includes('NORTHERN TERRITORY')) code = 'nt';
  else code = s.slice(0, 2).toLowerCase();

  return sha256(code.toLowerCase());
}

/**
 * 6. Zip / Postcode (zp):
 * Lowercase, trimmed, spaces removed.
 */
export function hashZip(zip?: string | null | number): string | null {
  if (zip === undefined || zip === null) return null;
  const cleaned = String(zip).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!cleaned) return null;
  return sha256(cleaned);
}

/**
 * 7. Country (country):
 * Two-letter lowercase country code (e.g. "au").
 */
export function hashCountry(country?: string | null): string | null {
  if (!country) return sha256('au');
  const cleaned = country.trim().toLowerCase();
  const code = cleaned.length === 2 ? cleaned : (cleaned.includes('australia') ? 'au' : cleaned.slice(0, 2));
  return sha256(code);
}

/**
 * 8. External ID (external_id):
 * CRM internal record ID hashed with SHA-256.
 */
export function hashExternalId(id?: string | null): string | null {
  if (!id) return null;
  return sha256(String(id).trim().toLowerCase());
}

/**
 * Formats Facebook Click ID (fbc) according to Meta specification:
 * fb.1.${creationTimestampMs}.${fbclid}
 */
export function formatFbc(fbclid?: string | null, timestampMs: number = Date.now()): string | undefined {
  if (!fbclid) return undefined;
  if (fbclid.startsWith('fb.1.')) return fbclid;
  return `fb.1.${timestampMs}.${fbclid}`;
}

/**
 * Generates the full Meta Conversions API (CAPI) user_data payload
 * with maximum Event Match Quality (EMQ).
 */
export interface MetaUserDataInput {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  city?: string | null;
  state?: string | null;
  postcode?: string | null | number;
  country?: string | null;
  externalId?: string | null;
  metaLeadgenId?: string | null;
  fbclid?: string | null;
  fbp?: string | null;
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
}

export function buildMetaUserData(input: MetaUserDataInput): Record<string, any> {
  const em = hashEmail(input.email);
  const ph = hashPhone(input.phone);

  let fn = hashName(input.firstName);
  let ln = hashName(input.lastName);
  if ((!fn || !ln) && input.fullName) {
    const split = hashFullName(input.fullName);
    if (!fn) fn = split.fn;
    if (!ln) ln = split.ln;
  }

  const ct = hashCity(input.city);
  const st = hashState(input.state);
  const zp = hashZip(input.postcode);
  const country = hashCountry(input.country);
  const extId = hashExternalId(input.externalId);

  const userData: Record<string, any> = {};

  if (em) userData.em = [em];
  if (ph) userData.ph = [ph];
  if (fn) userData.fn = [fn];
  if (ln) userData.ln = [ln];
  if (ct) userData.ct = [ct];
  if (st) userData.st = [st];
  if (zp) userData.zp = [zp];
  if (country) userData.country = [country];
  if (extId) userData.external_id = [extId];

  // Leadgen ID
  if (input.metaLeadgenId) {
    userData.lead_id = String(input.metaLeadgenId);
  }

  // Browser Cookies (unhashed)
  if (input.fbclid) {
    userData.fbc = formatFbc(input.fbclid);
  }
  if (input.fbp) {
    userData.fbp = input.fbp;
  }

  // Request Context (unhashed)
  if (input.clientIpAddress) {
    userData.client_ip_address = input.clientIpAddress;
  }
  if (input.clientUserAgent) {
    userData.client_user_agent = input.clientUserAgent;
  }

  return userData;
}
