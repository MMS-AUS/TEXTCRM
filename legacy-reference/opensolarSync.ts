/**
 * OpenSolar 2-Way Synchronization Core Service
 * Supports: Contacts, Companies, Leads, and Projects
 * Features:
 * - Exponential backoff & 429 Too Many Requests interception
 * - Infinite loop prevention (Payload Diffing, Actor Filtering, Source Origin Flag)
 * - Nested contacts_new support for new projects
 * - Signed contract retrieval and document linking
 */

export interface OpenSolarCredentialsConfig {
  orgId: string;
  apiToken: string;
  baseUrl?: string;
  integrationUserId?: string;
}

export interface SyncResult {
  success: boolean;
  osId?: string;
  syncedAt?: string;
  error?: string;
  statusCode?: number;
  skippedLoopPrevention?: boolean;
  reason?: string;
  payload?: any;
}

const DEFAULT_BASE_URL = 'https://api.opensolar.com';
const MAX_RETRIES = 5;

/**
 * Sleeps for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Resilient HTTP Client for OpenSolar API with Exponential Backoff & 429 Interception
 */
export async function makeOpenSolarRequest(
  url: string,
  options: RequestInit,
  attempt: number = 0,
  maxRetries: number = MAX_RETRIES
): Promise<Response> {
  try {
    const response = await fetch(url, options);

    // 429 Too Many Requests Interception
    if (response.status === 429) {
      if (attempt >= maxRetries) {
        throw new Error(
          `OpenSolar API Rate Limit (HTTP 429): Maximum retry count (${maxRetries}) exceeded.`
        );
      }

      // Check for Retry-After or X-RateLimit-Reset headers
      const retryAfterHeader = response.headers.get('Retry-After');
      const rateLimitResetHeader = response.headers.get('X-RateLimit-Reset');

      let delayMs: number;
      if (retryAfterHeader) {
        const seconds = parseInt(retryAfterHeader, 10);
        delayMs = (!isNaN(seconds) && seconds > 0 ? seconds : 2) * 1000;
      } else if (rateLimitResetHeader) {
        const resetTime = parseInt(rateLimitResetHeader, 10);
        const nowSec = Math.floor(Date.now() / 1000);
        const diff = resetTime - nowSec;
        delayMs = Math.max(diff, 2) * 1000;
      } else {
        // Standard exponential backoff: 2s, 4s, 8s, 16s, 32s
        delayMs = Math.pow(2, attempt + 1) * 1000;
      }

      console.warn(
        `[OpenSolar 429 Rate Limit] Pausing request for ${delayMs / 1000}s before retry attempt #${attempt + 1}...`
      );
      await sleep(delayMs);

      return makeOpenSolarRequest(url, options, attempt + 1, maxRetries);
    }

    return response;
  } catch (error: any) {
    if (attempt < maxRetries && error.message?.includes('fetch failed')) {
      const delayMs = Math.pow(2, attempt + 1) * 1000;
      console.warn(
        `[OpenSolar Network Error] Retrying in ${delayMs / 1000}s (attempt #${attempt + 1}):`,
        error.message
      );
      await sleep(delayMs);
      return makeOpenSolarRequest(url, options, attempt + 1, maxRetries);
    }
    throw error;
  }
}

// ==============================================================================
// LOOP PREVENTION STRATEGIES
// ==============================================================================

/**
 * Strategy 1: Payload Diffing (State Verification)
 * Compares incoming webhook fields against existing CRM record values.
 * Returns true if the incoming payload is identical to current DB state (echo loop).
 */
export function isPayloadIdentical(existingRecord: any, incomingFields: Record<string, any>): boolean {
  if (!existingRecord || !incomingFields) return false;

  const keyPairs: Array<[string, string]> = [
    ['first_name', 'firstName'],
    ['last_name', 'lastName'],
    ['name', 'title'],
    ['email', 'email'],
    ['phone', 'primaryMobile'],
    ['address', 'address'],
    ['stage', 'status'],
    ['system_size_kw', 'systemSizeKw'],
    ['nmi', 'nmi']
  ];

  let matches = 0;
  let evaluated = 0;

  for (const [incomingKey, dbKey] of keyPairs) {
    if (incomingFields[incomingKey] !== undefined) {
      evaluated++;
      const dbVal = existingRecord[dbKey] ?? existingRecord[incomingKey];
      const incVal = incomingFields[incomingKey];
      if (String(dbVal ?? '').trim().toLowerCase() === String(incVal ?? '').trim().toLowerCase()) {
        matches++;
      }
    }
  }

  // If evaluated at least 2 fields and all matched, it's an identical echo
  return evaluated >= 2 && matches === evaluated;
}

/**
 * Strategy 2: Actor / Integration User Filtering
 * Identifies if the event was triggered by the CRM integration service account
 */
export function isCrmIntegrationActor(
  payloadActorId?: string | null,
  configuredIntegrationUserId?: string | null
): boolean {
  if (!payloadActorId) return false;
  if (configuredIntegrationUserId && payloadActorId === configuredIntegrationUserId) {
    return true;
  }
  const normalized = String(payloadActorId).toLowerCase();
  return (
    normalized === 'crm_integration' ||
    normalized === 'crm-integration' ||
    normalized.includes('api_token') ||
    normalized.includes('system')
  );
}

/**
 * Strategy 3: The "Source Origin" Database Flag
 * Halts outbound sync if the record was recently touched by an incoming webhook
 */
export function shouldHaltOutboundSync(record: any): boolean {
  return record?.last_updated_by === 'webhook';
}

// ==============================================================================
// PAYLOAD BUILDERS (CRM ➔ OpenSolar)
// ==============================================================================

/**
 * Builds OpenSolar project payload from CRM Project
 * Automatically populates contacts_new when customer details are present
 */
export function buildOpenSolarProjectPayload(project: any): Record<string, any> {
  const firstName = project.firstName || project.customerName?.split(' ')[0] || '';
  const lastName = project.lastName || project.customerName?.split(' ').slice(1).join(' ') || '';
  const email = project.email || project.primaryEmail || '';
  const phone = project.primaryMobile || project.phone || project.secondaryMobile || '';

  const payload: Record<string, any> = {
    title: project.title || `${firstName} ${lastName} - Solar Installation`.trim(),
    address: project.address || project.installation_address || '',
    suburb: project.suburb || project.installation_suburb || '',
    state: project.state || project.installation_state || 'NSW',
    postcode: project.postcode || project.installation_postcode || '',
    country: 'Australia',
    stage: project.status === 'Contract Signed' ? 'Contract Signed' : (project.status || 'Design & Proposal'),
    system_size_kw: parseFloat(String(project.systemSizeKw || project.system_size_kw || 6.6)) || 6.6,
    notes: project.salesTeamNotes || project.notes || ''
  };

  // Hardware specifications if present
  if (project.panelManufacturer || project.panelModel) {
    payload.panel_brand = project.panelManufacturer || project.panelBrand || '';
    payload.panel_model = project.panelModel || '';
    payload.panel_count = parseInt(String(project.noOfPanels || 0), 10) || 0;
  }
  if (project.inverterManufacturer || project.inverterModel) {
    payload.inverter_brand = project.inverterManufacturer || project.inverterBrand || '';
    payload.inverter_model = project.inverterModel || '';
    payload.inverter_count = parseInt(String(project.noOfInverters || 1), 10) || 1;
  }
  if (project.nmi) {
    payload.nmi = project.nmi;
    payload.electricity_distributor = project.electricityDistributor || '';
  }

  // If customer doesn't have an existing OpenSolar Contact ID, nest inside contacts_new
  if (!project.openSolarContactId && (firstName || lastName || email)) {
    payload.contacts_new = [
      {
        first_name: firstName || 'Customer',
        last_name: lastName || '',
        email: email,
        phone: phone,
        is_primary: true
      }
    ];
  }

  return payload;
}

/**
 * Builds OpenSolar contact payload
 */
export function buildOpenSolarContactPayload(contact: any): Record<string, any> {
  const firstName = contact.firstName || contact.first_name || contact.name?.split(' ')[0] || '';
  const lastName = contact.lastName || contact.last_name || contact.name?.split(' ').slice(1).join(' ') || '';

  return {
    first_name: firstName,
    last_name: lastName,
    email: contact.email || contact.primaryEmail || '',
    phone: contact.phone || contact.primaryMobile || contact.mobile || '',
    address: contact.address || '',
    suburb: contact.suburb || '',
    state: contact.state || 'NSW',
    postcode: contact.postcode || '',
    country: 'Australia',
    notes: contact.notes || ''
  };
}

/**
 * Builds OpenSolar company payload
 */
export function buildOpenSolarCompanyPayload(company: any): Record<string, any> {
  return {
    name: company.name || company.companyName || '',
    email: company.email || '',
    phone: company.phone || '',
    abn: company.abn || company.taxNumber || '',
    address: company.address || '',
    suburb: company.suburb || '',
    state: company.state || 'NSW',
    postcode: company.postcode || '',
    country: 'Australia'
  };
}

// ==============================================================================
// OUTBOUND SYNCHRONIZATION RUNNERS
// ==============================================================================

/**
 * Outbound Sync for Project: CRM ➔ OpenSolar
 */
export async function syncProjectToOpenSolar(
  project: any,
  action: 'create' | 'update' = 'create',
  config: OpenSolarCredentialsConfig
): Promise<SyncResult> {
  // Strategy 3: Check Source Origin Flag
  if (shouldHaltOutboundSync(project)) {
    return {
      success: true,
      skippedLoopPrevention: true,
      reason: "Skipped outbound sync: Record was updated by OpenSolar webhook (last_updated_by = 'webhook')"
    };
  }

  if (!config.orgId || !config.apiToken) {
    return {
      success: false,
      error: 'Missing OpenSolar Organization ID (OPENSOLAR_ORG_ID) or API Bearer Token (OPENSOLAR_API_TOKEN)'
    };
  }

  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const payload = buildOpenSolarProjectPayload(project);
  const osId = project.os_id || project.openSolarProposalId;

  const isUpdate = action === 'update' && Boolean(osId);
  const endpoint = isUpdate
    ? `${baseUrl}/api/orgs/${config.orgId}/projects/${osId}/`
    : `${baseUrl}/api/orgs/${config.orgId}/projects/`;

  const method = isUpdate ? 'PATCH' : 'POST';

  try {
    const response = await makeOpenSolarRequest(endpoint, {
      method,
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        success: false,
        statusCode: response.status,
        error: data?.detail || data?.message || `HTTP ${response.status} from OpenSolar`,
        payload
      };
    }

    const assignedOsId = data.id || data.project_id || osId || `os-prj-${Date.now()}`;
    return {
      success: true,
      osId: String(assignedOsId),
      syncedAt: new Date().toISOString(),
      payload: data
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to communicate with OpenSolar API',
      payload
    };
  }
}

/**
 * Outbound Sync for Contact: CRM ➔ OpenSolar
 */
export async function syncContactToOpenSolar(
  contact: any,
  action: 'create' | 'update' = 'create',
  config: OpenSolarCredentialsConfig
): Promise<SyncResult> {
  if (shouldHaltOutboundSync(contact)) {
    return {
      success: true,
      skippedLoopPrevention: true,
      reason: "Skipped outbound sync: Record was updated by webhook (last_updated_by = 'webhook')"
    };
  }

  if (!config.orgId || !config.apiToken) {
    return {
      success: false,
      error: 'Missing OpenSolar Organization ID or API Token'
    };
  }

  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const payload = buildOpenSolarContactPayload(contact);
  const osId = contact.os_id || contact.openSolarContactId;

  const isUpdate = action === 'update' && Boolean(osId);
  const endpoint = isUpdate
    ? `${baseUrl}/api/orgs/${config.orgId}/contacts/${osId}/`
    : `${baseUrl}/api/orgs/${config.orgId}/contacts/`;

  const method = isUpdate ? 'PATCH' : 'POST';

  try {
    const response = await makeOpenSolarRequest(endpoint, {
      method,
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        success: false,
        statusCode: response.status,
        error: data?.detail || data?.message || `HTTP ${response.status}`
      };
    }

    const assignedOsId = data.id || data.contact_id || osId || `os-cnt-${Date.now()}`;
    return {
      success: true,
      osId: String(assignedOsId),
      syncedAt: new Date().toISOString(),
      payload: data
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to sync contact with OpenSolar'
    };
  }
}

/**
 * Outbound Sync for Company: CRM ➔ OpenSolar
 */
export async function syncCompanyToOpenSolar(
  company: any,
  action: 'create' | 'update' = 'create',
  config: OpenSolarCredentialsConfig
): Promise<SyncResult> {
  if (shouldHaltOutboundSync(company)) {
    return {
      success: true,
      skippedLoopPrevention: true,
      reason: "Skipped outbound sync: Record was updated by webhook (last_updated_by = 'webhook')"
    };
  }

  if (!config.orgId || !config.apiToken) {
    return {
      success: false,
      error: 'Missing OpenSolar Organization ID or API Token'
    };
  }

  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const payload = buildOpenSolarCompanyPayload(company);
  const osId = company.os_id;

  const isUpdate = action === 'update' && Boolean(osId);
  const endpoint = isUpdate
    ? `${baseUrl}/api/orgs/${config.orgId}/companies/${osId}/`
    : `${baseUrl}/api/orgs/${config.orgId}/companies/`;

  const method = isUpdate ? 'PATCH' : 'POST';

  try {
    const response = await makeOpenSolarRequest(endpoint, {
      method,
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        success: false,
        statusCode: response.status,
        error: data?.detail || data?.message || `HTTP ${response.status}`
      };
    }

    const assignedOsId = data.id || osId || `os-cmp-${Date.now()}`;
    return {
      success: true,
      osId: String(assignedOsId),
      syncedAt: new Date().toISOString()
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to sync company with OpenSolar'
    };
  }
}

// ==============================================================================
// WEBHOOK SETUP & INITIALIZATION
// ==============================================================================

/**
 * Registers the CRM webhook receiver with the OpenSolar API
 * POST https://api.opensolar.com/api/orgs/:org_id/webhooks/
 */
export async function registerOpenSolarWebhook(
  config: OpenSolarCredentialsConfig,
  webhookEndpointUrl: string
): Promise<{ success: boolean; webhookId?: string; error?: string; response?: any }> {
  if (!config.orgId || !config.apiToken) {
    return {
      success: false,
      error: 'Missing OpenSolar Org ID or API Bearer Token'
    };
  }

  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const endpoint = `${baseUrl}/api/orgs/${config.orgId}/webhooks/`;

  const payload = {
    endpoint: webhookEndpointUrl,
    description: 'CRM Bidirectional Sync & Contract Retrieval Webhook',
    trigger_fields: [
      'project.*',
      'contact.*',
      'quote.*',
      'contract.*'
    ],
    payload_fields: [
      'project.*',
      'contact.*',
      'quote.*',
      'contract.*'
    ],
    events: ['CREATE', 'UPDATE', 'DELETE'],
    is_active: true
  };

  try {
    const response = await makeOpenSolarRequest(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        success: false,
        error: data?.detail || data?.message || `HTTP ${response.status}`,
        response: data
      };
    }

    return {
      success: true,
      webhookId: String(data.id || `wh-${Date.now()}`),
      response: data
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to register webhook with OpenSolar'
    };
  }
}

// ==============================================================================
// SIGNED CONTRACT DOCUMENT RETRIEVAL
// ==============================================================================

/**
 * Downloads the signed PDF contract from OpenSolar API
 */
export async function downloadOpenSolarSignedContract(
  config: OpenSolarCredentialsConfig,
  osProjectId: string
): Promise<{ success: boolean; buffer?: Buffer; fileName?: string; error?: string }> {
  if (!config.orgId || !config.apiToken) {
    return { success: false, error: 'Missing OpenSolar credentials' };
  }

  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const endpointsToTry = [
    `${baseUrl}/api/orgs/${config.orgId}/projects/${osProjectId}/contract/pdf/`,
    `${baseUrl}/api/orgs/${config.orgId}/projects/${osProjectId}/contracts/download/`,
    `${baseUrl}/api/orgs/${config.orgId}/projects/${osProjectId}/document/`
  ];

  for (const endpoint of endpointsToTry) {
    try {
      const response = await makeOpenSolarRequest(endpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.apiToken}`,
          'Accept': 'application/pdf, application/json'
        }
      });

      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const fileName = `OpenSolar_Signed_Contract_Project_${osProjectId}.pdf`;
        return { success: true, buffer, fileName };
      }
    } catch {
      // Continue to next endpoint candidate
    }
  }

  return {
    success: false,
    error: `Could not download signed contract for OpenSolar project ${osProjectId}`
  };
}
