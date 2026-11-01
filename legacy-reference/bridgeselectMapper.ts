/**
 * BridgeSelect Connector API Data Transformation & Validation Utility
 * Maps CRM Job, Customer, and Installer records to the BridgeSelect Connector JSON payload.
 */

export interface BridgeSelectJobPayload {
  // Core Job & Customer Identity
  id: string;
  fn: string;
  ln: string;
  e: string;
  p: string;

  // Installation Site Details
  addr: string;
  suburb: string;
  state: string;
  pc: string;
  nmi: string;

  // Solar System Specifications
  pv_brand: string;
  pv_model: string;
  pv_qty: number;
  inv_brand: string;
  inv_model: string;
  inv_series: string;
  sys_size: number;

  // Compliance & Installer Details
  install_date: string;
  installer_name: string;
  installer_cec: string;
}

/**
 * Normalizes dates strictly to YYYY-MM-DD
 */
function normalizeDate(rawDate?: string | Date | null): string {
  if (!rawDate) return '';
  try {
    const d = new Date(rawDate);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
  } catch {
    return '';
  }
}

/**
 * Maps CRM data objects (job/project, customer, installer) to BridgeSelect's required JSON keys.
 * Handles null or missing values gracefully by providing empty strings "" or numeric defaults.
 */
export function mapJobToBridgeSelectPayload(
  job: any = {},
  customer: any = {},
  installer: any = {}
): BridgeSelectJobPayload {
  // Split customerName if first_name / last_name not explicitly provided
  let firstName =
    customer?.first_name ||
    customer?.firstName ||
    job?.first_name ||
    job?.firstName ||
    '';
  let lastName =
    customer?.last_name ||
    customer?.lastName ||
    job?.last_name ||
    job?.lastName ||
    '';

  if (!firstName && !lastName && (job?.customerName || customer?.name)) {
    const fullName = (job?.customerName || customer?.name || '').trim();
    const parts = fullName.split(' ');
    firstName = parts[0] || '';
    lastName = parts.slice(1).join(' ') || '';
  }

  // Fallback field resolution across camelCase and snake_case CRM models
  const email =
    customer?.email ||
    job?.customerEmail ||
    job?.email ||
    job?.primaryEmail ||
    '';

  const phone =
    customer?.phone_number ||
    customer?.phone ||
    customer?.mobile ||
    job?.customerPhone ||
    job?.primaryMobile ||
    job?.phone ||
    '';

  const address =
    job?.installation_address ||
    job?.address ||
    customer?.address ||
    '';

  const suburb =
    job?.installation_suburb ||
    job?.suburb ||
    customer?.suburb ||
    '';

  const state =
    job?.installation_state ||
    job?.state ||
    customer?.state ||
    'NSW';

  const postcode =
    job?.installation_postcode ||
    job?.postcode ||
    customer?.postcode ||
    job?.installationPostcode ||
    '';

  const nmi =
    job?.nmi_number ||
    job?.nmi ||
    job?.meterNumber ||
    job?.nmiNumber ||
    '';

  const pvBrand =
    job?.panel_brand ||
    job?.panelBrand ||
    job?.panelManufacturer ||
    job?.panelsBrand ||
    job?.pv_brand ||
    job?.solarPanelBrand ||
    '';

  const pvModel =
    job?.panel_model ||
    job?.panelModel ||
    job?.pv_model ||
    job?.solarPanelModel ||
    '';

  const pvQty = parseInt(
    String(job?.panel_quantity ?? job?.panelCount ?? job?.noOfPanels ?? job?.panelQty ?? 0),
    10
  ) || 0;

  const invBrand =
    job?.inverter_brand ||
    job?.inverterBrand ||
    job?.inverterManufacturer ||
    job?.inv_brand ||
    '';

  const invModel =
    job?.inverter_model ||
    job?.inverterModel ||
    job?.inv_model ||
    '';

  const invSeries =
    job?.inverter_series ||
    job?.inverterSeries ||
    job?.inv_series ||
    '';

  const sysSize = parseFloat(
    String(
      job?.calculated_system_size_kw ??
      job?.systemSizeKw ??
      job?.system_size_kw ??
      (pvQty > 0 ? (pvQty * 0.44).toFixed(2) : '0')
    )
  ) || 0;

  const rawInstallDate =
    job?.installation_date ||
    job?.installationDate ||
    job?.install_date ||
    job?.installDate ||
    job?.completedDate ||
    '';

  const installDate = normalizeDate(rawInstallDate);

  const installerName =
    installer?.full_name ||
    installer?.name ||
    job?.subcontractorName ||
    job?.installer_name ||
    job?.installerName ||
    '';

  const installerCec =
    installer?.cec_accreditation_number ||
    installer?.cec_number ||
    installer?.cecAccreditation ||
    installer?.cecNumber ||
    job?.subcontractorCec ||
    job?.installer_cec ||
    '';

  return {
    id: String(job?.id || job?.projectCode || ''),
    fn: String(firstName).trim(),
    ln: String(lastName).trim(),
    e: String(email).trim(),
    p: String(phone).trim(),
    addr: String(address).trim(),
    suburb: String(suburb).trim(),
    state: String(state).trim().toUpperCase(),
    pc: String(postcode).trim(),
    nmi: String(nmi).trim().toUpperCase(),
    pv_brand: String(pvBrand).trim(),
    pv_model: String(pvModel).trim(),
    pv_qty: pvQty,
    inv_brand: String(invBrand).trim(),
    inv_model: String(invModel).trim(),
    inv_series: String(invSeries).trim(),
    sys_size: sysSize,
    install_date: installDate,
    installer_name: String(installerName).trim(),
    installer_cec: String(installerCec).trim()
  };
}

/**
 * Pre-Push Validation Logic:
 * Validates that all mandatory STC fields are present before executing hashing & push.
 * Mandatory checks: fn, ln, addr, pc, state, nmi, and at least one PV/Inverter combination.
 * Throws a standard error if validation fails.
 */
export function validateBridgeSelectPayload(payload: BridgeSelectJobPayload): void {
  const missingFields: string[] = [];

  if (!payload.fn) missingFields.push('Customer First Name (fn)');
  if (!payload.ln) missingFields.push('Customer Last Name (ln)');
  if (!payload.addr) missingFields.push('Installation Address (addr)');
  if (!payload.pc) missingFields.push('Postcode (pc)');
  if (!payload.state) missingFields.push('State (state)');
  if (!payload.nmi) missingFields.push('NMI - National Meter Identifier (nmi)');

  const hasPv = Boolean(payload.pv_brand && (payload.pv_model || payload.pv_qty > 0));
  const hasInverter = Boolean(payload.inv_brand);

  if (!hasPv || !hasInverter) {
    missingFields.push('Solar PV Brand & Inverter Brand (at least one PV/Inverter combination)');
  }

  if (missingFields.length > 0) {
    throw new Error(`Missing required STC fields: ${missingFields.join(', ')}`);
  }
}
