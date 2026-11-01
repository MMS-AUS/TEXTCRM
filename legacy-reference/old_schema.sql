-- ==============================================================================
-- MY SOLAR CRM & ERP - COMPLETE MASTER DATABASE MIGRATION SCRIPT
-- Target: Supabase (PostgreSQL 15+)
-- Run this entire script in Supabase Dashboard -> SQL Editor -> New query -> Run
-- ==============================================================================

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. CRM CORE: CONTACTS & COMPANIES
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  company_owner TEXT,
  company_owner_name TEXT,
  phone TEXT,
  country TEXT DEFAULT 'Australia',
  abn TEXT,
  type TEXT DEFAULT 'Commercial Customer',
  state TEXT DEFAULT 'NSW',
  city TEXT,
  email TEXT,
  contact_person TEXT,
  cec_accredited BOOLEAN DEFAULT false,
  credit_limit NUMERIC(12,2) DEFAULT 0,
  active_projects_count INTEGER DEFAULT 0,
  abn_verified BOOLEAN DEFAULT false,
  os_id TEXT,
  last_synced_at TIMESTAMPTZ,
  last_updated_by TEXT DEFAULT 'crm_user',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT,
  last_name TEXT,
  name TEXT NOT NULL,
  street_address TEXT,
  suburb TEXT,
  state TEXT DEFAULT 'NSW',
  postcode TEXT,
  area TEXT,
  email TEXT,
  phone TEXT,
  contact_owner TEXT,
  contact_owner_name TEXT,
  contact_type TEXT,
  primary_company TEXT,
  city TEXT,
  address TEXT,
  addresses JSONB DEFAULT '[]'::jsonb,
  type TEXT DEFAULT 'Residential',
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  company_name TEXT,
  source TEXT DEFAULT 'Manual',
  open_solar_contact_id TEXT,
  os_id TEXT,
  last_synced_at TIMESTAMPTZ,
  last_updated_by TEXT DEFAULT 'crm_user',
  assigned_voip_line_number TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_contacted_at TIMESTAMPTZ
);

-- ==============================================================================
-- 3. CRM LEADS & PIPELINE
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  project_number TEXT,
  lead_date DATE DEFAULT CURRENT_DATE,
  platform TEXT DEFAULT 'Website',
  sales_person_name TEXT,
  state TEXT DEFAULT 'NSW',
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  customer_name TEXT,
  email TEXT,
  phone TEXT,
  phone_number TEXT,
  primary_mobile TEXT,
  secondary_mobile TEXT,
  address TEXT,
  suburb TEXT,
  postcode TEXT,
  area TEXT,
  nearest_big_city TEXT,
  address_verified BOOLEAN DEFAULT false,
  manager_rentee_first_name TEXT,
  manager_rentee_last_name TEXT,
  sales_team_notes TEXT,
  selling_price NUMERIC(12,2),
  system_price_aud NUMERIC(12,2),
  deposit NUMERIC(12,2),
  deposit_aud NUMERIC(12,2),
  deposit_received_date DATE,
  sale_date DATE,
  property_type TEXT DEFAULT 'Residential',
  roof_type TEXT,
  electrical_phase TEXT,
  phase TEXT,
  phase_type TEXT,
  house_storey TEXT,
  system_size_kw NUMERIC(8,2),
  panel_count INTEGER,
  no_of_panels INTEGER,
  panel_manufacturer TEXT,
  panel_model TEXT,
  panel_size NUMERIC(8,2),
  panel_size_w TEXT,
  panel_series TEXT,
  inverter_size_kw NUMERIC(8,2),
  no_of_inverters INTEGER,
  inverter_manufacturer TEXT,
  inverter_model TEXT,
  inverter_series TEXT,
  battery_storage_kwh NUMERIC(8,2),
  battery_required BOOLEAN DEFAULT false,
  no_of_batteries INTEGER,
  battery_manufacturer TEXT,
  battery_model TEXT,
  battery_usable_capacity_kwh NUMERIC(8,2),
  battery_size TEXT,
  quarterly_bill_aud NUMERIC(10,2),
  budget_aud NUMERIC(12,2),
  quoted_price_aud NUMERIC(12,2),
  status TEXT DEFAULT 'New',
  stage TEXT DEFAULT 'Inquiry',
  source TEXT DEFAULT 'Organic',
  notes TEXT,
  docs_received TEXT,
  docs_received_date DATE,
  existing_system_details TEXT,
  sheet_sync_row_id TEXT,
  os_id TEXT,
  assigned_to TEXT,
  xero_invoice_id TEXT,
  xero_invoice_number TEXT,
  xero_invoice_total NUMERIC(12,2),
  xero_invoice_status TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lead_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- Note, Email, Call, Task, Meeting, Status Change
  title TEXT NOT NULL,
  description TEXT,
  created_by TEXT,
  completed BOOLEAN DEFAULT false,
  due_date TIMESTAMPTZ,
  call_outcome TEXT,
  call_duration TEXT,
  recording_url TEXT,
  voipline_call_id TEXT,
  priority TEXT DEFAULT 'Medium',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lead_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  size_bytes BIGINT,
  category TEXT,
  file_url TEXT,
  uploaded_by TEXT DEFAULT 'staff',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==============================================================================
-- 4. SOLAR OPERATIONS: PROJECTS & JOBS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  project_number TEXT UNIQUE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  address TEXT NOT NULL,
  suburb TEXT,
  state TEXT DEFAULT 'NSW',
  postcode TEXT,
  system_size NUMERIC(8,2) DEFAULT 6.6,
  status TEXT DEFAULT 'Quote Sent',
  stage TEXT DEFAULT 'Design',
  total_price NUMERIC(12,2) DEFAULT 0,
  system_price NUMERIC(12,2) DEFAULT 0,
  system_price_aud NUMERIC(12,2) DEFAULT 0,
  budget_aud NUMERIC(12,2) DEFAULT 0,
  deposit_paid NUMERIC(12,2) DEFAULT 0,
  deposit NUMERIC(12,2) DEFAULT 0,
  deposit_aud NUMERIC(12,2) DEFAULT 0,
  deposit_received_date DATE,
  os_id TEXT,
  bridgeselect_sync_status TEXT DEFAULT 'pending',
  bridgeselect_synced_at TIMESTAMPTZ,
  installer_assigned TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  job_type TEXT DEFAULT 'Installation',
  status TEXT DEFAULT 'Scheduled',
  scheduled_date DATE,
  installer_name TEXT,
  subcontractor_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  notes TEXT,
  bridgeselect_sync_status TEXT DEFAULT 'pending',
  bridgeselect_synced_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'Signed Contract',
  file_size TEXT,
  mime_type TEXT,
  download_url TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sync_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_type TEXT NOT NULL, -- 'contact', 'project', 'company', 'lead'
  model_id TEXT NOT NULL,
  action TEXT NOT NULL,     -- 'create', 'update', 'delete'
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ DEFAULT now(),
  payload JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==============================================================================
-- 5. THIRD-PARTY CREDENTIALS & INTEGRATIONS
-- ==============================================================================

-- Xero OAuth 2.0 Credentials
CREATE TABLE IF NOT EXISTS public.xero_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  tenant_id TEXT NOT NULL,
  tenant_name TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Xero Payment Receipts
CREATE TABLE IF NOT EXISTS public.xero_payment_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  contact_id TEXT,
  contact_name TEXT,
  contact_email TEXT,
  payment_date DATE NOT NULL,
  amount_paid_aud NUMERIC(12,2) NOT NULL,
  payment_method TEXT DEFAULT 'Direct Debit / EFT',
  bank_reference TEXT,
  allocated_to_invoice_aud NUMERIC(12,2),
  remaining_invoice_balance_aud NUMERIC(12,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Gmail OAuth Credentials
CREATE TABLE IF NOT EXISTS public.gmail_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  email_address TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  send_enabled BOOLEAN NOT NULL DEFAULT false,
  latest_history_id TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Synced Emails
CREATE TABLE IF NOT EXISTS public.emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  message_id TEXT NOT NULL UNIQUE,
  thread_id TEXT,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT,
  snippet TEXT,
  body_html TEXT,
  body_text TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  labels TEXT[],
  has_attachments BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- CER BridgeSelect STC Portal Credentials
CREATE TABLE IF NOT EXISTS public.bridgeselect_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  account_key TEXT NOT NULL,
  account_salt TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Sinch MessageMedia SMS Credentials & Logs
CREATE TABLE IF NOT EXISTS public.messagemedia_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  user_id UUID,
  api_key TEXT NOT NULL,
  api_secret TEXT NOT NULL,
  default_sender_id TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sms_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  user_id UUID,
  contact_id UUID,
  lead_id UUID,
  project_id UUID,
  recipient_number TEXT,
  destination_number TEXT,
  sender_id TEXT,
  sender_number TEXT,
  message_body TEXT,
  message_content TEXT,
  provider_message_id TEXT,
  message_id TEXT,
  direction TEXT NOT NULL DEFAULT 'outbound',
  status TEXT NOT NULL DEFAULT 'sent',
  delivery_status TEXT DEFAULT 'enroute',
  error_message TEXT,
  error_code TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sms_logs_project_id ON public.sms_logs(project_id);

-- VoIPLine Telecom AU
CREATE TABLE IF NOT EXISTS public.voipline_settings (
  tenant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key TEXT NOT NULL,
  webhook_secret TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_phone_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,
  user_name TEXT,
  assigned_number TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voipline_call_id TEXT UNIQUE NOT NULL,
  contact_id TEXT,
  user_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status TEXT NOT NULL DEFAULT 'originating',
  duration INTEGER DEFAULT 0,
  recording_url TEXT,
  caller_number TEXT,
  callee_number TEXT,
  message_body TEXT,
  timestamp TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inbound_sms_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id TEXT,
  user_id TEXT,
  sender_number TEXT NOT NULL,
  dest_number TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'inbound',
  message_body TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- OpenSolar Credentials
CREATE TABLE IF NOT EXISTS public.opensolar_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  org_id TEXT NOT NULL,
  api_token TEXT NOT NULL,
  webhook_id TEXT,
  integration_user_id TEXT,
  webhook_secret TEXT,
  base_url TEXT DEFAULT 'https://api.opensolar.com',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- WhatsApp Cloud API
CREATE TABLE IF NOT EXISTS public.whatsapp_settings (
  tenant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number_id TEXT NOT NULL,
  waba_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  webhook_verify_token TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  wa_message_id TEXT UNIQUE NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_body TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  timestamp TIMESTAMPTZ DEFAULT now(),
  has_media BOOLEAN DEFAULT false,
  media_url TEXT,
  media_type TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Microsoft Teams Webhooks & Integrations
CREATE TABLE IF NOT EXISTS public.teams_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_url TEXT NOT NULL,
  channel_name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.teams_integration_settings (
  tenant_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  client_secret TEXT,
  team_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Meta Ads Page Connections
CREATE TABLE IF NOT EXISTS public.meta_page_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id TEXT UNIQUE NOT NULL,
  page_name TEXT NOT NULL,
  access_token TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==============================================================================
-- 5B. SETTINGS & INTEGRATIONS PERSISTENCE
-- ==============================================================================

-- Global System Settings (Key-Value JSONB store for dropdowns, rules, features, profile, RBAC)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  category TEXT DEFAULT 'general',
  description TEXT,
  updated_by TEXT DEFAULT 'crm_admin',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Centralized Integrations Configuration
CREATE TABLE IF NOT EXISTS public.integrations_config (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  enabled BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'disconnected',
  config JSONB DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ,
  sync_frequency TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Dedicated Dropdown Options Table
CREATE TABLE IF NOT EXISTS public.dropdown_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (category, value)
);

-- ==============================================================================
-- 5B. DYNAMIC HARDWARE CATALOG & GENERAL SYSTEM DROPDOWNS
-- ==============================================================================

-- 1. solar_panels (Watts only stores clean numeric values)
CREATE TABLE IF NOT EXISTS public.solar_panels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand TEXT NOT NULL,
  watts NUMERIC(8,2) NOT NULL,
  series TEXT,
  model TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. solar_inverters (Rated kW only stores clean numeric values)
CREATE TABLE IF NOT EXISTS public.solar_inverters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand TEXT NOT NULL,
  rated_kw NUMERIC(8,2) NOT NULL,
  series TEXT,
  model TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. battery_storage (Capacity only stores clean numeric values)
CREATE TABLE IF NOT EXISTS public.battery_storage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand TEXT NOT NULL,
  capacity NUMERIC(8,2) NOT NULL,
  series TEXT,
  model TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. system_dropdowns (General presets by category)
CREATE TABLE IF NOT EXISTS public.system_dropdowns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT UNIQUE NOT NULL,
  data JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. customer_support_tickets (Complete Warranty, Hardware & Resolution Support)
CREATE TABLE IF NOT EXISTS public.customer_support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id VARCHAR(100) NOT NULL,
  installation_project_no VARCHAR(100) NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  installation_date DATE,
  first_name TEXT,
  last_name TEXT,
  contact_number VARCHAR(50),
  email_id TEXT,
  address TEXT,
  suburb VARCHAR(150),
  post_code VARCHAR(20),
  state VARCHAR(20) DEFAULT 'NSW',
  phase VARCHAR(50) DEFAULT 'Single Phase',
  storey_type VARCHAR(50) DEFAULT 'Single Storey',
  issue_recorded TEXT,
  initial_check TEXT,
  work_required TEXT,
  issue_resolution_status VARCHAR(50) DEFAULT 'Open',
  no_of_existing_inverters INTEGER DEFAULT 1,
  existing_inverter_brand TEXT,
  existing_inverter_model TEXT,
  existing_inverter_size TEXT,
  existing_inverter_serials TEXT,
  no_of_existing_panels INTEGER DEFAULT 0,
  existing_panel_brand TEXT,
  existing_panel_model TEXT,
  existing_panel_size TEXT,
  affected_panel_serials TEXT,
  existing_battery_brand TEXT,
  existing_battery_model TEXT,
  existing_battery_size_capacity TEXT,
  affected_battery_serials TEXT,
  service_issue_notes TEXT,
  no_of_replaced_inverters INTEGER DEFAULT 0,
  replaced_inverter_brand TEXT,
  replaced_inverter_model TEXT,
  replaced_inverter_size TEXT,
  replaced_inverter_serials TEXT,
  no_of_replaced_panels INTEGER DEFAULT 0,
  replaced_panel_brand TEXT,
  replaced_panel_model TEXT,
  replaced_panel_size TEXT,
  replaced_panel_serials TEXT,
  replaced_battery_brand TEXT,
  replaced_battery_model TEXT,
  replaced_battery_size_capacity TEXT,
  replaced_battery_serials TEXT,
  warranty_claim_date DATE,
  warranty_claim_id VARCHAR(100),
  warranty_claim_status VARCHAR(50) DEFAULT 'Draft',
  claim_invoice_number VARCHAR(100),
  claim_invoice_amount_aud NUMERIC(12, 2) DEFAULT 0.00,
  claim_invoice_status VARCHAR(50),
  brand_notes TEXT,
  installer_name TEXT,
  installer_contact_number VARCHAR(50),
  installer_email TEXT,
  installer_company_name TEXT,
  installer_invoice_date DATE,
  installer_invoice_number VARCHAR(100),
  installer_invoice_amount_aud NUMERIC(12, 2) DEFAULT 0.00,
  installer_invoice_status VARCHAR(50),
  installer_notes TEXT,
  resolution_status VARCHAR(50) DEFAULT 'Pending',
  issue_resolution_date DATE,
  service_handler TEXT,
  service_charge_aud NUMERIC(12, 2) DEFAULT 0.00,
  total_amount_aud NUMERIC(12, 2) DEFAULT 0.00,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==============================================================================
-- 6. INDEXES FOR HIGH-THROUGHPUT PERFORMANCE
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_contacts_email ON public.contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON public.contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_os_id ON public.contacts(os_id);
CREATE INDEX IF NOT EXISTS idx_leads_email ON public.leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON public.leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_os_id ON public.leads(os_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON public.projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_os_id ON public.projects(os_id);
CREATE INDEX IF NOT EXISTS idx_jobs_project_id ON public.jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON public.sync_queue(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_emails_message_id ON public.emails(message_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_timestamp ON public.call_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sms_logs_dest ON public.sms_logs(destination_number);
CREATE INDEX IF NOT EXISTS idx_app_settings_category ON public.app_settings(category);
CREATE INDEX IF NOT EXISTS idx_integrations_config_category ON public.integrations_config(category);
CREATE INDEX IF NOT EXISTS idx_dropdown_options_category ON public.dropdown_options(category);

-- ==============================================================================
-- 6. email_logs (Outbound & SMTP System Transmission & Diagnostic Logs)
CREATE TABLE IF NOT EXISTS public.email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID DEFAULT '00000000-0000-0000-0000-000000000001',
  message_id TEXT,
  client_ref_id TEXT,
  sender_email TEXT NOT NULL,
  sender_name TEXT,
  recipient_email TEXT NOT NULL,
  recipient_emails TEXT[] DEFAULT '{}'::TEXT[],
  cc_emails TEXT[] DEFAULT '{}'::TEXT[],
  bcc_emails TEXT[] DEFAULT '{}'::TEXT[],
  reply_to TEXT,
  subject TEXT NOT NULL,
  snippet TEXT,
  body_html TEXT,
  body_text TEXT,
  category VARCHAR(100) DEFAULT 'general',
  reference_id TEXT,
  delivery_mode VARCHAR(50) DEFAULT 'custom_smtp',
  status VARCHAR(50) NOT NULL DEFAULT 'sent',
  success BOOLEAN NOT NULL DEFAULT true,
  smtp_host TEXT,
  smtp_port INTEGER DEFAULT 587,
  smtp_secure BOOLEAN DEFAULT false,
  smtp_username TEXT,
  smtp_response_code INTEGER,
  smtp_response_message TEXT,
  accepted_recipients TEXT[] DEFAULT '{}'::TEXT[],
  rejected_recipients TEXT[] DEFAULT '{}'::TEXT[],
  error_message TEXT,
  error_code VARCHAR(100),
  error_command VARCHAR(100),
  error_details JSONB DEFAULT '{}'::JSONB,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON public.email_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_success ON public.email_logs (success);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON public.email_logs (status);
CREATE INDEX IF NOT EXISTS idx_email_logs_recipient ON public.email_logs (recipient_email);
CREATE INDEX IF NOT EXISTS idx_email_logs_category ON public.email_logs (category);

-- ==============================================================================
-- 7. ENABLE ROW LEVEL SECURITY & PERMISSIVE POLICIES
-- ==============================================================================

DO $$ 
DECLARE
  tbl text;
BEGIN
  FOR tbl IN 
    SELECT tablename FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename IN (
      'companies', 'contacts', 'leads', 'lead_activities', 'lead_attachments',
      'projects', 'jobs', 'project_documents', 'sync_queue',
      'xero_credentials', 'xero_payment_receipts', 'gmail_credentials', 'emails',
      'bridgeselect_credentials', 'messagemedia_credentials', 'sms_logs',
      'voipline_settings', 'user_phone_numbers', 'call_logs', 'inbound_sms_logs',
      'opensolar_credentials', 'whatsapp_settings', 'whatsapp_messages',
      'teams_webhooks', 'teams_integration_settings', 'meta_page_connections',
      'app_settings', 'integrations_config', 'dropdown_options',
      'solar_panels', 'solar_inverters', 'battery_storage', 'system_dropdowns',
      'customer_support_tickets', 'email_logs'
    )
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "crm_allow_all_%s" ON public.%I;', tbl, tbl);
    EXECUTE format('CREATE POLICY "crm_allow_all_%s" ON public.%I FOR ALL USING (true);', tbl, tbl);

  END LOOP;
END $$;

-- 8. Storage bucket for WhatsApp media if using Supabase Storage
INSERT INTO storage.buckets (id, name, public)
VALUES ('whatsapp_media', 'whatsapp_media', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public access to whatsapp media" ON storage.objects;
CREATE POLICY "Public access to whatsapp media"
ON storage.objects FOR ALL
USING (bucket_id = 'whatsapp_media');

-- ==============================================================================
-- DONE! All MySolar CRM & ERP tables, indexes, and credentials stores created.
-- ==============================================================================
