import { Lead } from '../types/index.ts';

/**
 * Google Sheets Lead Template Specification & Downloader
 * Generates official CSV & XLSX-compatible formats mapping accurately to the
 * 23-field dynamic Lead Architecture in MySolarCRM.
 */

export interface GoogleSheetLeadColumn {
  header: string;
  key: string;
  example: string;
  description: string;
  required: boolean;
  type: string;
}

export const GOOGLE_SHEET_LEAD_COLUMNS: GoogleSheetLeadColumn[] = [
  {
    header: 'Lead Date',
    key: 'leadDate',
    example: '2026-09-16',
    description: 'Date the lead was generated (YYYY-MM-DD or DD/MM/YYYY)',
    required: true,
    type: 'Date'
  },
  {
    header: 'Platform',
    key: 'platform',
    example: 'Meta Lead Ads (Facebook/Instagram)',
    description: 'Inbound marketing source (Meta, Google Search, TikTok, Referral, etc.)',
    required: false,
    type: 'Text'
  },
  {
    header: 'Sales Rep',
    key: 'salesPersonName',
    example: 'Mitchell Barnes',
    description: 'Assigned Solar Sales Consultant in CRM',
    required: false,
    type: 'Text'
  },
  {
    header: 'Status',
    key: 'status',
    example: 'New',
    description: 'Pipeline Stage: New, Contacted, Site Survey Scheduled, Proposal Sent, Contract Signed, Deposit Received',
    required: false,
    type: 'Text'
  },
  {
    header: 'First Name',
    key: 'firstName',
    example: 'Ashleigh',
    description: 'Homeowner or decision maker first name',
    required: true,
    type: 'Text'
  },
  {
    header: 'Last Name',
    key: 'lastName',
    example: 'Miller',
    description: 'Homeowner or decision maker last name',
    required: true,
    type: 'Text'
  },
  {
    header: 'Primary Mobile',
    key: 'primaryMobile',
    example: '0433 112 998',
    description: 'Australian mobile number (auto-formatted with 0 prefix)',
    required: true,
    type: 'Phone'
  },
  {
    header: 'Secondary Mobile',
    key: 'secondaryMobile',
    example: '0433 998 112',
    description: 'Secondary mobile or partner contact number',
    required: false,
    type: 'Phone'
  },
  {
    header: 'Email',
    key: 'email',
    example: 'ashleigh.m@outlook.com.au',
    description: 'Customer email address for solar quotes & customer portal',
    required: true,
    type: 'Email'
  },
  {
    header: 'Street Address',
    key: 'address',
    example: '50 Brisbane Street',
    description: 'Physical installation property address',
    required: true,
    type: 'Address'
  },
  {
    header: 'Suburb',
    key: 'suburb',
    example: 'Ipswich',
    description: 'Property suburb (used to auto-detect nearest Australian major city)',
    required: true,
    type: 'Text'
  },
  {
    header: 'State',
    key: 'state',
    example: 'QLD',
    description: 'Australian State: NSW, QLD, VIC, WA, SA, TAS, ACT, NT',
    required: true,
    type: 'State'
  },
  {
    header: 'Postcode',
    key: 'postcode',
    example: '4305',
    description: '4-digit Australian postcode (auto-classifies Metro vs Regional)',
    required: true,
    type: 'Postcode'
  },
  {
    header: 'Area',
    key: 'area',
    example: 'Metro',
    description: 'Metro or Regional (leave blank to auto-calculate from postcode)',
    required: false,
    type: 'Calculated'
  },
  {
    header: 'Nearest Big City',
    key: 'nearestBigCity',
    example: 'Brisbane',
    description: 'Closest metropolitan capital (leave blank to auto-calculate)',
    required: false,
    type: 'Calculated'
  },
  {
    header: 'System Size kW',
    key: 'systemSizeKw',
    example: '10.4',
    description: 'Desired solar PV capacity in kilowatts',
    required: false,
    type: 'Number'
  },
  {
    header: 'Battery Required',
    key: 'batteryRequired',
    example: 'Yes',
    description: 'Whether energy storage is requested (Yes/No)',
    required: false,
    type: 'Boolean'
  },
  {
    header: 'Property Type',
    key: 'propertyType',
    example: 'Residential Single-Storey',
    description: 'Residential Single-Storey, Double-Storey, Commercial, Multi-dwelling',
    required: false,
    type: 'Text'
  },
  {
    header: 'Roof Type',
    key: 'roofType',
    example: 'Colorbond / Metal Sheet',
    description: 'Colorbond, Tile, Tin, Klip-Lok, Slate, Terracotta',
    required: false,
    type: 'Text'
  },
  {
    header: 'System Price AUD',
    key: 'systemPrice',
    example: '14900',
    description: 'Gross turnkey solar proposal price ($)',
    required: false,
    type: 'Currency'
  },
  {
    header: 'Selling Price AUD',
    key: 'sellingPrice',
    example: '10800',
    description: 'Net price after STC rebate discount ($)',
    required: false,
    type: 'Currency'
  },
  {
    header: 'Deposit AUD',
    key: 'deposit',
    example: '1500',
    description: 'Initial deposit amount received or agreed ($)',
    required: false,
    type: 'Currency'
  },
  {
    header: 'Sales Notes',
    key: 'salesTeamNotes',
    example: 'DNSP pre-approval submitted. Customer interested in 9.6kWh battery upgrade.',
    description: 'Internal consultation notes and customer requirements',
    required: false,
    type: 'Text'
  }
];

export function generateGoogleSheetLeadTemplateCsv(): string {
  const headers = GOOGLE_SHEET_LEAD_COLUMNS.map(c => `"${c.header.replace(/"/g, '""')}"`).join(',');
  
  // Row 1: Example Row 1 (Metro QLD)
  const sample1 = [
    '2026-09-16',
    'Meta Lead Ads (Facebook/Instagram)',
    'Mitchell Barnes',
    'New',
    'Ashleigh',
    'Miller',
    '0433 112 998',
    '0433 998 112',
    'ashleigh.m@outlook.com.au',
    '50 Brisbane Street',
    'Ipswich',
    'QLD',
    '4305',
    'Metro',
    'Brisbane',
    '10.4',
    'Yes',
    'Residential Single-Storey',
    'Colorbond / Metal Sheet',
    '14900',
    '10800',
    '1500',
    'Signed commercial solar agreement. Needs Energex DNSP fast-track.'
  ].map(val => `"${val.replace(/"/g, '""')}"`).join(',');

  // Row 2: Example Row 2 (Regional NSW)
  const sample2 = [
    '2026-09-15',
    'Meta Lead Ads (Facebook/Instagram)',
    'Chloe Gallagher',
    'Proposal Sent',
    'Declan',
    'Macarthur',
    '0455 223 881',
    '',
    'declan.m@geelongsolar.com.au',
    '82 Moorabool Street',
    'Geelong',
    'VIC',
    '3220',
    'Regional',
    'Geelong',
    '13.2',
    'Yes',
    'Residential Double-Storey',
    'Concrete Tile',
    '16800',
    '12400',
    '2000',
    'Requested Sungrow hybrid inverter with backup gateway.'
  ].map(val => `"${val.replace(/"/g, '""')}"`).join(',');

  // Row 3: Minimal Row (Testing blank defaults)
  const sample3 = [
    '2026-09-14',
    'Website Contact Form',
    'Liam Evans',
    'New',
    'Sarah',
    'Jenkins',
    '0412 345 678',
    '',
    'sarah.jenkins@gmail.com',
    '142 Pacific Highway',
    'North Sydney',
    'NSW',
    '2060',
    '',
    '',
    '6.6',
    'No',
    'Residential Single-Storey',
    'Colorbond / Metal Sheet',
    '6990',
    '4800',
    '500',
    'Interested in 6.6kW single phase system with Ausgrid connection.'
  ].map(val => `"${val.replace(/"/g, '""')}"`).join(',');

  return `${headers}\r\n${sample1}\r\n${sample2}\r\n${sample3}\r\n`;
}

/**
 * Trigger direct in-browser download of the Google Sheet Lead Format
 */
export function downloadGoogleSheetLeadFormat(filename = 'MySolarCRM_Leads_GoogleSheet_Format.csv') {
  const csvContent = generateGoogleSheetLeadTemplateCsv();
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Detect delimiter: tab (TSV copied from Google Sheets / Excel), comma (CSV), or semicolon
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const semicolons = (firstLine.match(/;/g) || []).length;

  if (tabs > 0 && tabs >= commas) return '\t';
  if (semicolons > commas) return ';';
  return ',';
}

/**
 * Robust CSV / TSV line splitter that respects quoted strings
 */
export function splitCsvLine(line: string, delimiter = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Parses any Google Sheets / CSV text containing leads into Lead objects.
 * Handles:
 * - Direct copied cells from Google Sheets (Tab-separated)
 * - Standard CSV files (Comma-separated)
 * - European CSV files (Semicolon-separated)
 * - Flexible column name aliases (Full Name, Customer Name, Mobile Number, Phone, etc.)
 */
export function parseGoogleSheetCsv(csvText: string): Partial<Lead>[] {
  if (!csvText || typeof csvText !== 'string') return [];

  const delimiter = detectDelimiter(csvText);

  // Normalize line endings
  const rawLines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines = rawLines.map(l => l.trim()).filter(l => l.length > 0);

  if (lines.length < 2) return [];

  // Parse header line
  const rawHeaders = splitCsvLine(lines[0], delimiter);
  const cleanHeaders = rawHeaders.map(h =>
    h.toLowerCase().replace(/[^a-z0-9]/g, '')
  );

  // Map header indexes to known lead fields
  const fieldIndexMap: Record<string, number> = {};

  cleanHeaders.forEach((h, idx) => {
    if (h === 'id' || h === 'leadid' || h === 'leadno' || h === 'leadnum' || h === 'leadnumber' || h === 'rowid' || h === 'uid' || h.includes('leadid') || h.includes('recordid')) {
      fieldIndexMap.id = idx;
    } else if (h.includes('project#') || h.includes('projectnumber') || h.includes('projectno')) {
      fieldIndexMap.projectNumber = idx;
    } else if (h.includes('leaddate') || h.includes('submissiondate') || h.includes('createdtime') || h.includes('timestamp') || h === 'date') {
      fieldIndexMap.leadDate = idx;
    } else if (h.includes('platform') || h.includes('source') || h.includes('channel') || h.includes('campaign')) {
      fieldIndexMap.platform = idx;
    } else if (h.includes('salesrep') || h.includes('salesperson') || h.includes('rep') || h.includes('consultant') || h.includes('agent') || h.includes('assignedto')) {
      fieldIndexMap.salesPersonName = idx;
    } else if (h.includes('status') || h.includes('stage') || h.includes('pipeline')) {
      fieldIndexMap.status = idx;
    } else if (h.includes('firstname') || h === 'first' || h.includes('givenname')) {
      fieldIndexMap.firstName = idx;
    } else if (h.includes('lastname') || h === 'last' || h.includes('surname') || h.includes('familyname')) {
      fieldIndexMap.lastName = idx;
    } else if (h.includes('fullname') || h.includes('customername') || h.includes('clientname') || h === 'name' || h === 'customer' || h === 'client') {
      fieldIndexMap.fullName = idx;
    } else if (h.includes('secondarymobile') || h.includes('altphone') || h.includes('secondaryphone') || h.includes('mobile2') || h.includes('phone2')) {
      fieldIndexMap.secondaryMobile = idx;
    } else if (h.includes('mobile') || h.includes('phone') || h.includes('cell') || h.includes('tel') || h.includes('contactno') || h.includes('contactnumber') || h.includes('primarymobile')) {
      if (fieldIndexMap.primaryMobile === undefined) {
        fieldIndexMap.primaryMobile = idx;
      }
    } else if (h.includes('email') || h.includes('mail')) {
      fieldIndexMap.email = idx;
    } else if (h.includes('streetaddress') || h.includes('address') || h.includes('street') || h.includes('location') || h.includes('siteaddress')) {
      fieldIndexMap.address = idx;
    } else if (h.includes('suburb') || h.includes('town') || h.includes('locality')) {
      fieldIndexMap.suburb = idx;
    } else if (h.includes('state') || h.includes('province') || h.includes('territory')) {
      fieldIndexMap.state = idx;
    } else if (h.includes('postcode') || h.includes('postalcode') || h.includes('zip') || h.includes('pcode')) {
      fieldIndexMap.postcode = idx;
    } else if (h.includes('area') || h.includes('region')) {
      fieldIndexMap.area = idx;
    } else if (h.includes('nearestbigcity') || h.includes('nearestcity') || (h.includes('city') && !h.includes('suburb'))) {
      fieldIndexMap.nearestBigCity = idx;
    } else if (h.includes('systemsize') || h.includes('syssize') || h.includes('kw') || h.includes('solarsize') || h.includes('panelsize') || h.includes('capacity')) {
      fieldIndexMap.systemSizeKw = idx;
    } else if (h.includes('battery') || h.includes('storage') || h.includes('powerwall')) {
      fieldIndexMap.batteryRequired = idx;
    } else if (h.includes('propertytype') || h.includes('property') || h.includes('building') || h.includes('storeys') || h.includes('storey')) {
      fieldIndexMap.propertyType = idx;
    } else if (h.includes('rooftype') || h.includes('roof')) {
      fieldIndexMap.roofType = idx;
    } else if (h.includes('systemprice') || h.includes('quoteprice') || h.includes('grossprice') || h.includes('totalprice')) {
      fieldIndexMap.systemPrice = idx;
    } else if (h.includes('sellingprice') || h.includes('netprice') || h.includes('contractprice') || (h.includes('price') && !h.includes('system'))) {
      fieldIndexMap.sellingPrice = idx;
    } else if (h.includes('deposit')) {
      fieldIndexMap.deposit = idx;
    } else if (h.includes('notes') || h.includes('salesnotes') || h.includes('comment') || h.includes('remarks') || h.includes('message') || h.includes('description')) {
      fieldIndexMap.salesTeamNotes = idx;
    }
  });

  const parsedLeads: Partial<Lead>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = splitCsvLine(lines[i], delimiter);
    if (row.length === 0 || (row.length === 1 && !row[0])) continue;

    const getValue = (field: string) => {
      const idx = fieldIndexMap[field];
      return idx !== undefined && idx < row.length ? row[idx].trim() : '';
    };

    let firstName = getValue('firstName');
    let lastName = getValue('lastName');
    const fullName = getValue('fullName');

    // If separate first/last name not found, split fullName
    if ((!firstName && !lastName) && fullName) {
      const parts = fullName.trim().split(/\s+/);
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ') || '';
    }

    const email = getValue('email');
    const rawMobile = getValue('primaryMobile');
    const rawSecondary = getValue('secondaryMobile');

    // Skip empty dummy rows that have no name, phone, or email
    if (!firstName && !lastName && !fullName && !email && !rawMobile) continue;

    let leadDate = getValue('leadDate');
    if (leadDate) {
      const dateParts = leadDate.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      if (dateParts) {
        const p1 = parseInt(dateParts[1], 10);
        const p2 = parseInt(dateParts[2], 10);
        const y = dateParts[3];
        // Standard Australian format is DD/MM/YYYY
        let d = String(p1).padStart(2, '0');
        let m = String(p2).padStart(2, '0');
        if (p1 <= 12 && p2 > 12) {
          // US format MM/DD/YYYY
          m = String(p1).padStart(2, '0');
          d = String(p2).padStart(2, '0');
        }
        leadDate = `${y}-${m}-${d}`;
      }
    } else {
      // Leave field blank when not provided in Google Sheet
      leadDate = '';
    }

    const rawSysSize = getValue('systemSizeKw');
    const sysSize = rawSysSize ? parseFloat(rawSysSize.replace(/[^0-9.]/g, '')) : undefined;

    const rawSysPrice = getValue('systemPrice');
    const sysPrice = rawSysPrice ? (parseFloat(rawSysPrice.replace(/[^0-9.]/g, '')) || rawSysPrice) : undefined;

    const rawSellPrice = getValue('sellingPrice');
    const sellPrice = rawSellPrice ? (parseFloat(rawSellPrice.replace(/[^0-9.]/g, '')) || rawSellPrice) : undefined;

    const rawDeposit = getValue('deposit');
    const depositAmt = rawDeposit ? (parseFloat(rawDeposit.replace(/[^0-9.]/g, '')) || rawDeposit) : undefined;

    const rawBattery = getValue('batteryRequired');
    let batteryRequired: boolean | undefined = undefined;
    if (rawBattery) {
      const bStr = rawBattery.toLowerCase().trim();
      batteryRequired = bStr === 'true' || bStr === 'yes' || bStr === 'y' || bStr === '1';
    }

    const rowExplicitId = getValue('id');
    const sheetSyncRowId = rowExplicitId || `GSHEET_ROW_${i + 1}`;

    let computedCustomerName = fullName || '';
    if (!computedCustomerName && (firstName || lastName)) {
      computedCustomerName = `${firstName} ${lastName}`.trim();
    }
    if (!computedCustomerName) {
      computedCustomerName = rawMobile || email || '';
    }

    // ONLY populate fields which have data in Google Sheets (leave missing fields completely blank)
    parsedLeads.push({
      id: rowExplicitId || undefined,
      projectNumber: getValue('projectNumber') || '',
      leadDate: leadDate || '',
      platform: getValue('platform') || '',
      salesPersonName: getValue('salesPersonName') || '',
      status: (getValue('status') as any) || '',
      firstName: firstName || '',
      lastName: lastName || '',
      customerName: computedCustomerName,
      primaryMobile: rawMobile || '',
      secondaryMobile: rawSecondary || '',
      email: email || '',
      address: getValue('address') || '',
      suburb: getValue('suburb') || '',
      state: (getValue('state') as any) || '',
      postcode: getValue('postcode') || '',
      area: (getValue('area') as any) || '',
      nearestBigCity: getValue('nearestBigCity') || '',
      systemSizeKw: sysSize !== undefined && !isNaN(sysSize) ? sysSize : undefined,
      batteryRequired,
      propertyType: getValue('propertyType') || '',
      roofType: getValue('roofType') || '',
      systemPrice: sysPrice !== undefined ? sysPrice : '',
      sellingPrice: sellPrice !== undefined ? sellPrice : '',
      deposit: depositAmt !== undefined ? depositAmt : '',
      depositReceivedDate: getValue('depositReceivedDate') || '',
      saleDate: getValue('saleDate') || '',
      sheetSyncRowId,
      salesTeamNotes: getValue('salesTeamNotes') || ''
    });
  }

  return parsedLeads;
}

/**
 * Normalizes phone numbers for duplicate checking across Australian & international formats.
 * e.g., '0412 345 678', '+61 412 345 678', '61412345678', '412345678', '0412345678'
 * all resolve to '0412345678'.
 */
export function normalizePhoneForComparison(phone?: string): string {
  if (!phone) return '';
  let digits = phone.replace(/[^0-9]/g, '');
  if (!digits) return '';

  // If Australian international prefix: 614... -> 04...
  if (digits.startsWith('61') && digits.length >= 10) {
    digits = '0' + digits.slice(2);
  }
  // If Australian mobile without leading 0: 4XXXXXXXX (9 digits starting with 4) -> 04XXXXXXXX
  if (digits.length === 9 && digits.startsWith('4')) {
    digits = '0' + digits;
  }
  return digits;
}

/**
 * Normalizes email address for comparison (trimmed and lowercased).
 */
export function normalizeEmailForComparison(email?: string): string {
  if (!email) return '';
  return email.trim().toLowerCase();
}

/**
 * Normalizes a person or business name for comparison (trimmed, lowercased, multiple spaces collapsed).
 */
export function normalizeNameForComparison(name?: string): string {
  if (!name) return '';
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Normalizes an address string for comparison (lowercased, removes punctuation, standardizes street suffixes).
 */
export function normalizeAddressForComparison(address?: string): string {
  if (!address) return '';
  return address
    .trim()
    .toLowerCase()
    .replace(/[,\.\-\/\\#]/g, ' ')
    .replace(/\b(street|st)\b/g, 'st')
    .replace(/\b(road|rd)\b/g, 'rd')
    .replace(/\b(avenue|ave)\b/g, 'ave')
    .replace(/\b(court|ct)\b/g, 'ct')
    .replace(/\b(drive|dr)\b/g, 'dr')
    .replace(/\b(lane|ln)\b/g, 'ln')
    .replace(/\b(place|pl)\b/g, 'pl')
    .replace(/\b(parade|pde)\b/g, 'pde')
    .replace(/\b(highway|hwy)\b/g, 'hwy')
    .replace(/\b(circuit|cct)\b/g, 'cct')
    .replace(/\b(crescent|cres|cr)\b/g, 'cres')
    .replace(/\b(close|cl)\b/g, 'cl')
    .replace(/\b(terrace|tce)\b/g, 'tce')
    .replace(/\b(boulevard|bvd|blvd)\b/g, 'blvd')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks whether two records (or addresses) represent distinct physical properties.
 * If both have street addresses that differ, or suburbs that differ, or postcodes that differ,
 * they are distinct properties.
 */
export function areDistinctProperties(
  a?: { address?: string; suburb?: string; postcode?: string; state?: string },
  b?: { address?: string; suburb?: string; postcode?: string; state?: string }
): boolean {
  if (!a || !b) return false;

  const addrA = normalizeAddressForComparison(a.address);
  const addrB = normalizeAddressForComparison(b.address);
  const subA = normalizeNameForComparison(a.suburb);
  const subB = normalizeNameForComparison(b.suburb);
  const pcA = (a.postcode || '').trim();
  const pcB = (b.postcode || '').trim();
  const stA = (a.state || '').trim().toUpperCase();
  const stB = (b.state || '').trim().toUpperCase();

  // 1. If both have street addresses and they differ, they are distinct properties
  if (addrA && addrB && addrA !== addrB) {
    return true;
  }

  // 2. If both have suburbs and they differ, they are distinct properties
  if (subA && subB && subA !== subB) {
    return true;
  }

  // 3. If both have postcodes and they differ, they are distinct properties
  if (pcA && pcB && pcA !== pcB) {
    return true;
  }

  // 4. If both have states and they differ, they are distinct properties
  if (stA && stB && stA !== stB) {
    return true;
  }

  return false;
}

/**
 * Checks whether two records represent the exact same physical property address.
 */
export function areSameProperty(
  a?: { address?: string; suburb?: string; postcode?: string; state?: string },
  b?: { address?: string; suburb?: string; postcode?: string; state?: string }
): boolean {
  if (!a || !b) return false;

  const addrA = normalizeAddressForComparison(a.address);
  const addrB = normalizeAddressForComparison(b.address);
  const subA = normalizeNameForComparison(a.suburb);
  const subB = normalizeNameForComparison(b.suburb);
  const pcA = (a.postcode || '').trim();
  const pcB = (b.postcode || '').trim();

  if (addrA && addrB) {
    return addrA === addrB;
  }

  if (!addrA && !addrB) {
    if (subA && subB && subA === subB && pcA && pcB && pcA === pcB) {
      return true;
    }
    if (!subA && !subB && !pcA && !pcB) {
      return true;
    }
  }

  return false;
}

/**
 * Generates a stable deterministic fingerprint for a lead record.
 */
export function generateLeadFingerprint(lead: {
  firstName?: string;
  lastName?: string;
  customerName?: string;
  primaryMobile?: string;
  phone?: string;
  secondaryMobile?: string;
  email?: string;
  address?: string;
  suburb?: string;
  postcode?: string;
}): string {
  const name = normalizeNameForComparison(lead.customerName || `${lead.firstName || ''} ${lead.lastName || ''}`.trim());
  const phone = normalizePhoneForComparison(lead.primaryMobile || lead.phone);
  const email = normalizeEmailForComparison(lead.email);
  const address = normalizeAddressForComparison(lead.address);
  const postcode = (lead.postcode || '').trim();

  return `${name}__${phone}__${email}__${address}__${postcode}`;
}

/**
 * Checks whether an incoming lead candidate matches any existing lead in the CRM system.
 * Returns { isDuplicate: boolean; matchedLead?: Lead; reason?: string }
 */
export function isLeadAlreadyInSystem(
  candidate: Partial<Lead>,
  existingLeads: Lead[]
): { isDuplicate: boolean; matchedLead?: Lead; reason?: string } {
  const candId = (candidate.id || '').trim();
  const candSheetRowId = (candidate.sheetSyncRowId || '').trim();
  const candEmail = normalizeEmailForComparison(candidate.email);
  const candPrimaryPhone = normalizePhoneForComparison(candidate.primaryMobile || candidate.phone);
  const candSecondaryPhone = normalizePhoneForComparison(candidate.secondaryMobile);
  const candFullName = normalizeNameForComparison(
    candidate.customerName || `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim()
  );
  const candAddress = normalizeAddressForComparison(candidate.address);
  const candSuburb = normalizeNameForComparison(candidate.suburb);
  const candPostcode = (candidate.postcode || '').trim();

  for (const existing of existingLeads) {
    // 1. Explicit ID match (if ID is from previous import)
    if (candId && existing.id === candId) {
      return { isDuplicate: true, matchedLead: existing, reason: `Matching Lead ID (${candId})` };
    }

    // 2. Stable Sheet Sync Row ID match
    if (candSheetRowId && existing.sheetSyncRowId && existing.sheetSyncRowId === candSheetRowId) {
      return { isDuplicate: true, matchedLead: existing, reason: `Matching Sheet Row ID (${candSheetRowId})` };
    }

    // 3. Email Match (if both have email and length > 3)
    if (candEmail && candEmail.length > 3) {
      const existingEmail = normalizeEmailForComparison(existing.email);
      if (existingEmail && existingEmail === candEmail) {
        // IMPORTANT: If they represent DIFFERENT properties for the same customer, they are 2 DIFFERENT LEADS!
        if (areDistinctProperties(candidate, existing)) {
          continue; // Skip this existing lead, check if another existing lead matches this specific property
        }
        return { isDuplicate: true, matchedLead: existing, reason: `Matching Email (${candidate.email})` };
      }
    }

    // 4. Phone Match (Primary or Secondary, at least 6 digits to avoid placeholders)
    const existPrimaryPhone = normalizePhoneForComparison(existing.primaryMobile || existing.phone);
    const existSecondaryPhone = normalizePhoneForComparison(existing.secondaryMobile);

    const checkPhoneMatch = (p1: string, p2: string) => {
      if (!p1 || !p2 || p1.length < 6 || p2.length < 6) return false;
      if (p1 === p2) return true;
      // Also match if last 9 digits match (e.g. mobile 412345678)
      if (p1.length >= 9 && p2.length >= 9 && p1.slice(-9) === p2.slice(-9)) return true;
      return false;
    };

    if (candPrimaryPhone) {
      if (checkPhoneMatch(candPrimaryPhone, existPrimaryPhone) || checkPhoneMatch(candPrimaryPhone, existSecondaryPhone)) {
        if (areDistinctProperties(candidate, existing)) {
          continue; // Same customer inquiring for a different property -> separate lead!
        }
        return { isDuplicate: true, matchedLead: existing, reason: `Matching Phone (${candidate.primaryMobile || candidate.phone})` };
      }
    }
    if (candSecondaryPhone) {
      if (checkPhoneMatch(candSecondaryPhone, existPrimaryPhone) || checkPhoneMatch(candSecondaryPhone, existSecondaryPhone)) {
        if (areDistinctProperties(candidate, existing)) {
          continue; // Same customer inquiring for a different property -> separate lead!
        }
        return { isDuplicate: true, matchedLead: existing, reason: `Matching Secondary Phone (${candidate.secondaryMobile})` };
      }
    }

    // 5. Name + Address Match (Strongest identity when phone or email is missing)
    const existFullName = normalizeNameForComparison(
      existing.customerName || `${existing.firstName || ''} ${existing.lastName || ''}`.trim()
    );
    const existAddress = normalizeAddressForComparison(existing.address);
    const existSuburb = normalizeNameForComparison(existing.suburb);
    const existPostcode = (existing.postcode || '').trim();

    if (candFullName && candFullName.length > 2 && existFullName && existFullName === candFullName) {
      if (areDistinctProperties(candidate, existing)) {
        continue; // Same customer name, but different property address -> separate lead!
      }
      // If address matches
      if (candAddress && existAddress && candAddress === existAddress) {
        return { isDuplicate: true, matchedLead: existing, reason: `Matching Name & Street Address (${existing.customerName}, ${existing.address})` };
      }
      // If suburb and postcode match
      if (candSuburb && existSuburb && candSuburb === existSuburb && candPostcode && existPostcode && candPostcode === existPostcode) {
        return { isDuplicate: true, matchedLead: existing, reason: `Matching Name & Suburb/Postcode (${existing.customerName}, ${existing.suburb} ${existing.postcode})` };
      }
      // If street address and suburb are both empty on both, and name matches
      if (!candAddress && !existAddress && candSuburb && existSuburb && candSuburb === existSuburb) {
        return { isDuplicate: true, matchedLead: existing, reason: `Matching Customer Name & Suburb (${existing.customerName})` };
      }
    }
  }

  return { isDuplicate: false };
}

/**
 * Parses any date string into a numeric millisecond timestamp for chronological sorting.
 * Handles ISO (YYYY-MM-DD), Australian (DD/MM/YYYY), US (MM/DD/YYYY), and ISO datetime formats.
 */
export function parseLeadDateTimestamp(dateStr?: string): number {
  if (!dateStr || typeof dateStr !== 'string') return 0;
  const trimmed = dateStr.trim();
  if (!trimmed) return 0;

  // 1. ISO format: YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = trimmed.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    return new Date(y, m, d).getTime();
  }

  // 2. Day/Month/Year or Month/Day/Year: DD/MM/YYYY or D/M/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (slashMatch) {
    const p1 = parseInt(slashMatch[1], 10);
    const p2 = parseInt(slashMatch[2], 10);
    const y = parseInt(slashMatch[3], 10);
    let day = p1;
    let month = p2 - 1;
    if (p1 <= 12 && p2 > 12) {
      // Month = p1, Day = p2 (US format MM/DD/YYYY)
      month = p1 - 1;
      day = p2;
    }
    return new Date(y, month, day).getTime();
  }

  const parsed = Date.parse(trimmed);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Always sorts leads on the basis of the Lead date, latest first.
 * If leadDate is identical or missing, falls back to createdAt or ID.
 */
export function sortLeadsByDateDesc(leadsList: Lead[]): Lead[] {
  return [...leadsList].sort((a, b) => {
    const timeA = parseLeadDateTimestamp(a.leadDate) || parseLeadDateTimestamp(a.createdAt);
    const timeB = parseLeadDateTimestamp(b.leadDate) || parseLeadDateTimestamp(b.createdAt);
    if (timeB !== timeA) {
      return timeB - timeA; // Latest date first
    }
    return (b.id || '').localeCompare(a.id || '');
  });
}

/**
 * Checks for updated fields from a Google Sheet row and applies them to an existing lead in the CRM.
 * Returns { hasChanges: boolean; updatedLead: Lead; changedFields: string[] }
 */
export function applySheetUpdatesToLead(
  existing: Lead,
  incoming: Partial<Lead>
): { hasChanges: boolean; updatedLead: Lead; changedFields: string[] } {
  let hasChanges = false;
  const changedFields: string[] = [];
  const updated: Lead = { ...existing };

  const updateFieldIfProvided = <K extends keyof Lead>(key: K, incomingVal: any) => {
    if (incomingVal !== undefined && incomingVal !== null && incomingVal !== '') {
      const existingValStr = String(existing[key] ?? '').trim();
      const incomingValStr = String(incomingVal).trim();
      if (existingValStr !== incomingValStr) {
        (updated as any)[key] = incomingVal;
        hasChanges = true;
        changedFields.push(String(key));
      }
    }
  };

  updateFieldIfProvided('status', incoming.status);
  updateFieldIfProvided('leadDate', incoming.leadDate);
  updateFieldIfProvided('platform', incoming.platform);
  updateFieldIfProvided('salesPersonName', incoming.salesPersonName);
  updateFieldIfProvided('saleDate', incoming.saleDate);
  updateFieldIfProvided('firstName', incoming.firstName);
  updateFieldIfProvided('lastName', incoming.lastName);
  updateFieldIfProvided('customerName', incoming.customerName);
  updateFieldIfProvided('primaryMobile', incoming.primaryMobile);
  updateFieldIfProvided('secondaryMobile', incoming.secondaryMobile);
  updateFieldIfProvided('email', incoming.email);
  updateFieldIfProvided('address', incoming.address);
  updateFieldIfProvided('suburb', incoming.suburb);
  updateFieldIfProvided('state', incoming.state);
  updateFieldIfProvided('postcode', incoming.postcode);
  updateFieldIfProvided('area', incoming.area);
  updateFieldIfProvided('nearestBigCity', incoming.nearestBigCity);
  updateFieldIfProvided('propertyType', incoming.propertyType);
  updateFieldIfProvided('roofType', incoming.roofType);
  updateFieldIfProvided('depositReceivedDate', incoming.depositReceivedDate);
  updateFieldIfProvided('projectNumber', incoming.projectNumber);

  if (incoming.systemSizeKw !== undefined && incoming.systemSizeKw !== null) {
    if (Number(existing.systemSizeKw) !== Number(incoming.systemSizeKw)) {
      updated.systemSizeKw = Number(incoming.systemSizeKw);
      hasChanges = true;
      changedFields.push('systemSizeKw');
    }
  }

  if (incoming.batteryRequired !== undefined && incoming.batteryRequired !== null) {
    if (Boolean(existing.batteryRequired) !== Boolean(incoming.batteryRequired)) {
      updated.batteryRequired = Boolean(incoming.batteryRequired);
      hasChanges = true;
      changedFields.push('batteryRequired');
    }
  }

  if (incoming.systemPrice !== undefined && incoming.systemPrice !== '' && incoming.systemPrice !== null) {
    if (String(existing.systemPrice) !== String(incoming.systemPrice)) {
      updated.systemPrice = incoming.systemPrice;
      hasChanges = true;
      changedFields.push('systemPrice');
    }
  }

  if (incoming.sellingPrice !== undefined && incoming.sellingPrice !== '' && incoming.sellingPrice !== null) {
    if (String(existing.sellingPrice) !== String(incoming.sellingPrice)) {
      updated.sellingPrice = incoming.sellingPrice;
      hasChanges = true;
      changedFields.push('sellingPrice');
    }
  }

  if (incoming.deposit !== undefined && incoming.deposit !== '' && incoming.deposit !== null) {
    if (String(existing.deposit) !== String(incoming.deposit)) {
      updated.deposit = incoming.deposit;
      hasChanges = true;
      changedFields.push('deposit');
    }
  }

  if (incoming.salesTeamNotes && incoming.salesTeamNotes.trim() && !incoming.salesTeamNotes.startsWith('Imported via Google Sheet at')) {
    if (existing.salesTeamNotes !== incoming.salesTeamNotes) {
      updated.salesTeamNotes = incoming.salesTeamNotes;
      hasChanges = true;
      changedFields.push('salesTeamNotes');
    }
  }

  // Aliases & derived fields sync
  if (incoming.primaryMobile && incoming.primaryMobile !== existing.phone) {
    updated.phone = incoming.primaryMobile;
  } else if (incoming.phone && incoming.phone !== existing.primaryMobile) {
    updated.primaryMobile = incoming.phone;
    updated.phone = incoming.phone;
  }

  if (incoming.salesPersonName && incoming.salesPersonName !== existing.assignedTo) {
    updated.assignedTo = incoming.salesPersonName;
  } else if (incoming.assignedTo && incoming.assignedTo !== existing.salesPersonName) {
    updated.salesPersonName = incoming.assignedTo;
    updated.assignedTo = incoming.assignedTo;
  }

  // Ensure full customerName is consistent if first or last name changed
  if (incoming.firstName || incoming.lastName) {
    const fn = updated.firstName || '';
    const ln = updated.lastName || '';
    const full = `${fn} ${ln}`.trim();
    if (full && full !== updated.customerName) {
      updated.customerName = full;
      hasChanges = true;
    }
  }

  // Address verification flag sync
  if (incoming.address !== undefined || incoming.postcode !== undefined) {
    const verified = Boolean(updated.address && updated.postcode);
    if (updated.addressVerified !== verified) {
      updated.addressVerified = verified;
      hasChanges = true;
    }
  }

  return { hasChanges, updatedLead: updated, changedFields };
}
