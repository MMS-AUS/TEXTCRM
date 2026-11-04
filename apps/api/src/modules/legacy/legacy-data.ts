import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

// The old CRM's JSON files (MMSCRM_V2.0-main/.leads_db.json, .contacts_db.json,
// .projects_db.json) — Step 3.4, §1.9. Only the fields the migration reads are described;
// everything else in the files is ignored. Values come as the old app stored them: strings,
// sometimes numbers, often "" for empty.

/** "" and null become undefined; numbers become text — the import cleaners take text. */
const text = z.preprocess((value) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return value.trim() === '' ? undefined : value.trim();
  return value;
}, z.string().optional());

const flag = z.preprocess(
  (value) => (value === 'true' ? true : value === 'false' ? false : value),
  z.boolean().optional(),
);

export const legacyLeadSchema = z.object({
  id: z.string(),
  projectNumber: text,
  leadDate: text,
  saleDate: text,
  platform: text,
  source: text,
  salesPersonName: text,
  assignedTo: text,
  status: text,
  firstName: text,
  lastName: text,
  managerRenteeFirstName: text,
  managerRenteeLastName: text,
  address: text,
  suburb: text,
  state: text,
  postcode: text,
  addressVerified: flag,
  primaryMobile: text,
  secondaryMobile: text,
  email: text,
  salesTeamNotes: text,
  systemPrice: text,
  sellingPrice: text,
  deposit: text,
  depositReceivedDate: text,
  systemSizeKw: text,
  batteryRequired: flag,
  propertyType: text,
  roofType: text,
  phaseType: text,
  houseStorey: text,
  existingSystemDetails: text,
  panelModel: text,
  noOfPanels: text,
  inverterModel: text,
  noOfInverters: text,
  createdAt: text,
  activities: z.array(z.unknown()).optional(),
});
export type LegacyLead = z.infer<typeof legacyLeadSchema>;

const legacyAddressSchema = z.object({
  street: text,
  suburb: text,
  state: text,
  postcode: text,
  isPrimary: flag,
});

export const legacyContactSchema = z.object({
  id: z.string(),
  firstName: text,
  lastName: text,
  email: text,
  phone: text,
  contactType: text,
  type: text,
  notes: text,
  streetAddress: text,
  suburb: text,
  state: text,
  postcode: text,
  addresses: z.array(legacyAddressSchema).optional(),
  createdAt: text,
});
export type LegacyContact = z.infer<typeof legacyContactSchema>;

export const legacyProjectSchema = z.object({
  id: z.string(),
  projectNumber: text,
  projectCode: text,
  title: text,
  status: text,
  projectStage: text,
  customerEmail: text,
  streetAddress: text,
  saleDate: text,
  depositReceivedDate: text,
  balancePayableDate: text,
  notes: text,
  salesTeamNotes: text,
  existingSystemDetails: text,
  // System
  systemSizeKw: text,
  panelModel: text,
  noOfPanels: text,
  inverterModel: text,
  noOfInverters: text,
  roofType: text,
  houseStorey: text,
  phase: text,
  nmi: text,
  // Pricing
  systemPrice: text,
  sellingPrice: text,
  contractValueAud: text,
  deposit: text,
  customerInvoiceNumber: text,
  // EB verification
  q1CustomerNameMatch: text,
  q2AddressMatch: text,
  q3MeterMatch: text,
  q4MeterPhase: text,
  q5OpenSolarSystemMatch: text,
  q6OpenSolarPricingMatch: text,
  docsReceived: text,
  docsReceivedDate: text,
  // Grid
  dnsp: text,
  electricityDistributor: text,
  gridAppRef: text,
  gridAppStatus: text,
  gridAppliedDate: text,
  gridApprovalDate: text,
  gridRejectedDate: text,
  energyRetailer: text,
  retailerRef: text,
  // Finance
  isOnFinance: text,
  financeCompanyName: text,
  financeStatus: text,
  // Warehouse
  warehouse: text,
  salesOrderNo: text,
  stockStatus: text,
  stockUsedProject: text,
  warehouseInvoiceNumber: text,
  warehouseInvoiceDate: text,
  warehouseInvoiceAmount: text,
  warehouseInvoiceStatus: text,
  // Installation
  installationStatus: text,
  installationDate: text,
  installationBookedBy: text,
  installationDocsStatus: text,
  installationDocsReceivedDate: text,
  installerName: text,
  installerInvoiceNumber: text,
  installerInvoiceDate: text,
  installerInvoiceAmount: text,
  installerInvoiceStatus: text,
  // STC
  stcTradedPortal: text,
  stcJobNo: text,
  stcStatus: text,
  stcSubmittedDate: text,
  solarStcs: text,
  solarStcsAmount: text,
  solarStcReceivedDate: text,
  batteryStcs: text,
  batteryStcsAmount: text,
  batteryStcReceivedDate: text,
  adminCharges: text,
  customerStcRateAud: text,
  internalStcRateAud: text,
});
export type LegacyProject = z.infer<typeof legacyProjectSchema>;

export type LegacyData = {
  leads: LegacyLead[];
  contacts: LegacyContact[];
  projects: LegacyProject[];
};

async function readList<T>(file: string, schema: z.ZodType<T>): Promise<T[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(
      `Couldn't read ${file}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const result = z.array(schema).safeParse(raw);
  if (!result.success) {
    throw new Error(`${file} isn't in the expected format: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** Reads the three files from the old project folder. */
export async function loadLegacyData(folder: string): Promise<LegacyData> {
  return {
    leads: await readList(path.join(folder, '.leads_db.json'), legacyLeadSchema),
    contacts: await readList(path.join(folder, '.contacts_db.json'), legacyContactSchema),
    projects: await readList(path.join(folder, '.projects_db.json'), legacyProjectSchema),
  };
}
