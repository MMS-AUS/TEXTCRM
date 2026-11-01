CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'system', 'sheet_sync', 'webhook', 'integration');--> statement-breakpoint
CREATE TYPE "public"."hardware_kind" AS ENUM('panel', 'inverter', 'battery');--> statement-breakpoint
CREATE TYPE "public"."ticket_hardware_role" AS ENUM('existing', 'replaced');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"changes" jsonb,
	"request_id" text,
	"ip_address" "inet",
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"abn" text,
	"abn_verified" boolean DEFAULT false NOT NULL,
	"phone" text,
	"email" text,
	"website" text,
	"street_address" text,
	"suburb" text,
	"state" text,
	"postcode" text,
	"country" text DEFAULT 'Australia' NOT NULL,
	"cec_accredited" boolean DEFAULT false NOT NULL,
	"credit_limit_aud" numeric(12, 2),
	"owner_user_id" uuid,
	"open_solar_id" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_abn_format" CHECK ("companies"."abn" ~ '^[0-9]{11}$'),
	CONSTRAINT "companies_email_lowercase" CHECK ("companies"."email" = lower(btrim("companies"."email")))
);
--> statement-breakpoint
CREATE TABLE "contact_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"property_type" text,
	"street_address" text NOT NULL,
	"suburb" text NOT NULL,
	"state" text NOT NULL,
	"postcode" text,
	"area" text,
	"nearest_big_city" text,
	"address_verified" boolean DEFAULT false NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"email" text,
	"mobile" text,
	"secondary_mobile" text,
	"type" text DEFAULT 'Residential' NOT NULL,
	"company_id" uuid,
	"owner_user_id" uuid,
	"source" text,
	"open_solar_contact_id" text,
	"notes" text,
	"last_contacted_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_email_lowercase" CHECK ("contacts"."email" = lower(btrim("contacts"."email"))),
	CONSTRAINT "contacts_mobile_e164" CHECK ("contacts"."mobile" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "contacts_secondary_mobile_e164" CHECK ("contacts"."secondary_mobile" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
CREATE TABLE "hardware_batteries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manufacturer" text NOT NULL,
	"model" text NOT NULL,
	"series" text,
	"usable_capacity_kwh" numeric(8, 2) NOT NULL,
	"size_label" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hardware_batteries_manufacturer_model_unique" UNIQUE("manufacturer","model")
);
--> statement-breakpoint
CREATE TABLE "hardware_inverters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manufacturer" text NOT NULL,
	"model" text NOT NULL,
	"series" text,
	"size_kw" numeric(8, 3) NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hardware_inverters_manufacturer_model_unique" UNIQUE("manufacturer","model")
);
--> statement-breakpoint
CREATE TABLE "hardware_panels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manufacturer" text NOT NULL,
	"model" text NOT NULL,
	"series" text,
	"size_w" numeric(8, 2) NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hardware_panels_manufacturer_model_unique" UNIQUE("manufacturer","model")
);
--> statement-breakpoint
CREATE TABLE "lead_pricing" (
	"lead_id" uuid PRIMARY KEY NOT NULL,
	"system_price_aud" numeric(12, 2),
	"selling_price_aud" numeric(12, 2),
	"deposit_aud" numeric(12, 2),
	"deposit_received_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_system_requirements" (
	"lead_id" uuid PRIMARY KEY NOT NULL,
	"system_size_kw" numeric(8, 2),
	"battery_required" boolean DEFAULT false NOT NULL,
	"property_type" text,
	"roof_type" text,
	"house_storey" text,
	"phase" text,
	"existing_system_details" text,
	"quarterly_bill_aud" numeric(12, 2),
	"panel_id" uuid,
	"panel_count" integer,
	"inverter_id" uuid,
	"inverter_count" integer,
	"battery_id" uuid,
	"battery_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_system_requirements_counts_non_negative" CHECK (coalesce("lead_system_requirements"."panel_count", 0) >= 0 and coalesce("lead_system_requirements"."inverter_count", 0) >= 0 and coalesce("lead_system_requirements"."battery_count", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"company_id" uuid,
	"lead_date" date DEFAULT current_date NOT NULL,
	"platform" text,
	"source" text,
	"status" text DEFAULT 'New' NOT NULL,
	"owner_user_id" uuid,
	"first_name" text NOT NULL,
	"last_name" text,
	"email" text,
	"mobile" text,
	"secondary_mobile" text,
	"manager_rentee_first_name" text,
	"manager_rentee_last_name" text,
	"street_address" text,
	"suburb" text,
	"state" text,
	"postcode" text,
	"area" text,
	"nearest_big_city" text,
	"address_verified" boolean DEFAULT false NOT NULL,
	"docs_received" text,
	"docs_received_date" date,
	"sale_date" date,
	"notes" text,
	"converted_at" timestamp with time zone,
	"sheet_lead_id" text,
	"crm_edited_at" timestamp with time zone,
	"meta_leadgen_id" text,
	"fbclid" text,
	"fbp" text,
	"deleted_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_email_lowercase" CHECK ("leads"."email" = lower(btrim("leads"."email"))),
	CONSTRAINT "leads_mobile_e164" CHECK ("leads"."mobile" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "leads_secondary_mobile_e164" CHECK ("leads"."secondary_mobile" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
CREATE TABLE "option_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "option_lists_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"value" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "options_list_value_unique" UNIQUE("list_id","value")
);
--> statement-breakpoint
CREATE TABLE "project_eb_verification" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"customer_name_match" text,
	"address_match" text,
	"meter_match" text,
	"meter_phase" text,
	"open_solar_system_match" text,
	"open_solar_pricing_match" text,
	"docs_received" text,
	"docs_received_date" date,
	"verified_by_user_id" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_finance" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"finance_option" text,
	"finance_company" text,
	"status" text,
	"applied_date" date,
	"approved_date" date,
	"approved_amount_aud" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_grid_applications" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"electricity_distributor" text,
	"application_ref" text,
	"status" text,
	"applied_date" date,
	"approval_date" date,
	"rejected_date" date,
	"energy_retailer" text,
	"retailer_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_installation" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"status" text,
	"booking_date" date,
	"booked_by_user_id" uuid,
	"completed_date" date,
	"installer_company_id" uuid,
	"installer_quoted_aud" numeric(12, 2),
	"docs_status" text,
	"docs_received_date" date,
	"installer_invoice_date" date,
	"installer_invoice_number" text,
	"installer_invoice_amount_aud" numeric(12, 2),
	"installer_invoice_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_opensolar" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"open_solar_project_id" text,
	"proposal_id" text,
	"signed_url" text,
	"contract_signed" boolean DEFAULT false NOT NULL,
	"contract_signed_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_pricing" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"system_price_aud" numeric(12, 2),
	"selling_price_aud" numeric(12, 2),
	"contract_value_aud" numeric(12, 2),
	"deposit_aud" numeric(12, 2),
	"deposit_received_date" date,
	"balance_due_date" date,
	"customer_invoice_number" text,
	"xero_invoice_id" text,
	"xero_invoice_number" text,
	"xero_invoice_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_stc_claims" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"portal" text,
	"job_number" text,
	"status" text,
	"submitted_date" date,
	"solar_stcs" integer,
	"solar_stcs_amount_aud" numeric(12, 2),
	"solar_stcs_received_date" date,
	"battery_stcs" integer,
	"battery_stcs_amount_aud" numeric(12, 2),
	"battery_stcs_received_date" date,
	"admin_charges_aud" numeric(12, 2),
	"customer_stc_rate_aud" numeric(12, 2),
	"internal_stc_rate_aud" numeric(12, 2),
	"bridgeselect_sync_status" text,
	"bridgeselect_synced_at" timestamp with time zone,
	"bridgeselect_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_system_design" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"system_size_kw" numeric(8, 2),
	"panel_id" uuid,
	"panel_count" integer,
	"inverter_id" uuid,
	"inverter_count" integer,
	"battery_id" uuid,
	"battery_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_system_design_counts_non_negative" CHECK (coalesce("project_system_design"."panel_count", 0) >= 0 and coalesce("project_system_design"."inverter_count", 0) >= 0 and coalesce("project_system_design"."battery_count", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "project_warehouse" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"warehouse" text,
	"sales_order_number" text,
	"invoice_date" date,
	"invoice_number" text,
	"invoice_amount_aud" numeric(12, 2),
	"invoice_status" text,
	"invoice_paid_date" date,
	"stock_status" text,
	"stock_used_project" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_number" text NOT NULL,
	"title" text,
	"lead_id" uuid,
	"contact_id" uuid NOT NULL,
	"company_id" uuid,
	"status" text DEFAULT 'Active' NOT NULL,
	"stage" text DEFAULT 'Engineering & DNSP Approval' NOT NULL,
	"sales_user_id" uuid,
	"sale_date" date,
	"closed_at" timestamp with time zone,
	"street_address" text NOT NULL,
	"suburb" text NOT NULL,
	"state" text NOT NULL,
	"postcode" text,
	"area" text,
	"nearest_big_city" text,
	"house_storey" text,
	"roof_type" text,
	"phase" text,
	"existing_system_details" text,
	"manager_rentee_first_name" text,
	"manager_rentee_last_name" text,
	"nmi" text,
	"notes" text,
	"meta_leadgen_id" text,
	"fbclid" text,
	"fbp" text,
	"sold_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_project_number_unique" UNIQUE("project_number"),
	CONSTRAINT "projects_lead_id_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_hardware" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"role" "ticket_hardware_role" NOT NULL,
	"kind" "hardware_kind" NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"brand" text,
	"model" text,
	"size" text,
	"serial_numbers" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_hardware_quantity_non_negative" CHECK ("ticket_hardware"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ticket_installer_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"is_subcontractor" boolean DEFAULT true NOT NULL,
	"installer_company_id" uuid,
	"installer_name" text,
	"phone" text,
	"email" text,
	"visit_date" date,
	"notes" text,
	"invoice_date" date,
	"invoice_number" text,
	"invoice_amount_aud" numeric(12, 2),
	"invoice_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_warranty_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"claim_date" date,
	"claim_reference" text,
	"status" text,
	"invoice_number" text,
	"invoice_amount_aud" numeric(12, 2),
	"invoice_status" text,
	"brand_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_number" text NOT NULL,
	"project_id" uuid,
	"contact_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text,
	"priority" text DEFAULT 'Medium' NOT NULL,
	"issue_recorded" text,
	"initial_check" text,
	"work_required" text,
	"resolution_status" text DEFAULT 'Under Investigation' NOT NULL,
	"service_issue_notes" text,
	"assigned_user_id" uuid,
	"resolved_date" date,
	"closed_at" timestamp with time zone,
	"service_charge_aud" numeric(12, 2),
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_ticket_number_unique" UNIQUE("ticket_number")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"can_view" boolean DEFAULT false NOT NULL,
	"can_create" boolean DEFAULT false NOT NULL,
	"can_edit" boolean DEFAULT false NOT NULL,
	"can_delete" boolean DEFAULT false NOT NULL,
	"can_export" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_id_feature_pk" PRIMARY KEY("role_id","feature")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"firebase_uid" text,
	"role_id" uuid NOT NULL,
	"department" text,
	"voipline_number" text,
	"sms_sender_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"last_sign_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_firebase_uid_unique" UNIQUE("firebase_uid"),
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower(btrim("users"."email")))
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_addresses" ADD CONSTRAINT "contact_addresses_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_pricing" ADD CONSTRAINT "lead_pricing_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_system_requirements" ADD CONSTRAINT "lead_system_requirements_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_system_requirements" ADD CONSTRAINT "lead_system_requirements_panel_id_hardware_panels_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."hardware_panels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_system_requirements" ADD CONSTRAINT "lead_system_requirements_inverter_id_hardware_inverters_id_fk" FOREIGN KEY ("inverter_id") REFERENCES "public"."hardware_inverters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_system_requirements" ADD CONSTRAINT "lead_system_requirements_battery_id_hardware_batteries_id_fk" FOREIGN KEY ("battery_id") REFERENCES "public"."hardware_batteries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "options" ADD CONSTRAINT "options_list_id_option_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."option_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_eb_verification" ADD CONSTRAINT "project_eb_verification_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_eb_verification" ADD CONSTRAINT "project_eb_verification_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_finance" ADD CONSTRAINT "project_finance_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_grid_applications" ADD CONSTRAINT "project_grid_applications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_installation" ADD CONSTRAINT "project_installation_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_installation" ADD CONSTRAINT "project_installation_booked_by_user_id_users_id_fk" FOREIGN KEY ("booked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_installation" ADD CONSTRAINT "project_installation_installer_company_id_companies_id_fk" FOREIGN KEY ("installer_company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_opensolar" ADD CONSTRAINT "project_opensolar_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_pricing" ADD CONSTRAINT "project_pricing_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stc_claims" ADD CONSTRAINT "project_stc_claims_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_system_design" ADD CONSTRAINT "project_system_design_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_system_design" ADD CONSTRAINT "project_system_design_panel_id_hardware_panels_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."hardware_panels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_system_design" ADD CONSTRAINT "project_system_design_inverter_id_hardware_inverters_id_fk" FOREIGN KEY ("inverter_id") REFERENCES "public"."hardware_inverters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_system_design" ADD CONSTRAINT "project_system_design_battery_id_hardware_batteries_id_fk" FOREIGN KEY ("battery_id") REFERENCES "public"."hardware_batteries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_warehouse" ADD CONSTRAINT "project_warehouse_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_sales_user_id_users_id_fk" FOREIGN KEY ("sales_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_hardware" ADD CONSTRAINT "ticket_hardware_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_installer_visits" ADD CONSTRAINT "ticket_installer_visits_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_installer_visits" ADD CONSTRAINT "ticket_installer_visits_installer_company_id_companies_id_fk" FOREIGN KEY ("installer_company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_warranty_claims" ADD CONSTRAINT "ticket_warranty_claims_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_occurred_at_idx" ON "audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "companies_name_idx" ON "companies" USING btree ("name");--> statement-breakpoint
CREATE INDEX "companies_abn_idx" ON "companies" USING btree ("abn");--> statement-breakpoint
CREATE INDEX "contact_addresses_contact_idx" ON "contact_addresses" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_addresses_one_primary_idx" ON "contact_addresses" USING btree ("contact_id") WHERE "contact_addresses"."is_primary";--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "contacts_mobile_idx" ON "contacts" USING btree ("mobile");--> statement-breakpoint
CREATE INDEX "contacts_company_idx" ON "contacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "contacts_name_idx" ON "contacts" USING btree ("last_name","first_name");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_owner_idx" ON "leads" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "leads_lead_date_idx" ON "leads" USING btree ("lead_date");--> statement-breakpoint
CREATE INDEX "leads_platform_idx" ON "leads" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "leads_contact_idx" ON "leads" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "leads" USING btree ("email");--> statement-breakpoint
CREATE INDEX "leads_mobile_idx" ON "leads" USING btree ("mobile");--> statement-breakpoint
CREATE INDEX "leads_sheet_lead_id_idx" ON "leads" USING btree ("sheet_lead_id");--> statement-breakpoint
CREATE INDEX "options_list_sort_idx" ON "options" USING btree ("list_id","sort_order");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_stage_idx" ON "projects" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "projects_contact_idx" ON "projects" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "projects_sales_user_idx" ON "projects" USING btree ("sales_user_id");--> statement-breakpoint
CREATE INDEX "ticket_hardware_ticket_idx" ON "ticket_hardware" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "ticket_installer_visits_ticket_idx" ON "ticket_installer_visits" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "ticket_warranty_claims_ticket_idx" ON "ticket_warranty_claims" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "tickets_project_idx" ON "tickets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tickets_contact_idx" ON "tickets" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "tickets_priority_idx" ON "tickets" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "tickets_resolution_status_idx" ON "tickets" USING btree ("resolution_status");--> statement-breakpoint
CREATE INDEX "tickets_assigned_user_idx" ON "tickets" USING btree ("assigned_user_id");