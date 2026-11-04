CREATE TABLE "import_job_rows" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "import_job_rows_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"import_job_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"data" jsonb NOT NULL,
	"action" text NOT NULL,
	"message" text,
	"record_id" uuid,
	"applied" boolean DEFAULT false NOT NULL,
	CONSTRAINT "import_job_rows_row_unique" UNIQUE("import_job_id","row_number"),
	CONSTRAINT "import_job_rows_action_valid" CHECK ("import_job_rows"."action" in ('create', 'update', 'skip', 'error'))
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target" text NOT NULL,
	"source_type" text NOT NULL,
	"file_name" text,
	"storage_key" text,
	"spreadsheet_id" text,
	"spreadsheet_title" text,
	"sheet_tab" text,
	"headers" jsonb,
	"mapping" jsonb,
	"status" text DEFAULT 'uploading' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_by_user_id" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_jobs_target_valid" CHECK ("import_jobs"."target" in ('leads', 'contacts')),
	CONSTRAINT "import_jobs_source_valid" CHECK ("import_jobs"."source_type" in ('upload', 'google_sheet'))
);
--> statement-breakpoint
CREATE TABLE "sheet_sync_run_errors" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sheet_sync_run_errors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"sheet_lead_id" text,
	"message" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheet_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"rows_read" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"linked_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "sheet_sync_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"spreadsheet_id" text NOT NULL,
	"spreadsheet_title" text,
	"sheet_tab" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "sheet_source_id" uuid;--> statement-breakpoint
ALTER TABLE "import_job_rows" ADD CONSTRAINT "import_job_rows_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_sync_run_errors" ADD CONSTRAINT "sheet_sync_run_errors_run_id_sheet_sync_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sheet_sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_sync_runs" ADD CONSTRAINT "sheet_sync_runs_source_id_sheet_sync_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sheet_sync_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_sync_sources" ADD CONSTRAINT "sheet_sync_sources_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_sync_sources" ADD CONSTRAINT "sheet_sync_sources_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_jobs_created_at_idx" ON "import_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sheet_sync_run_errors_run_idx" ON "sheet_sync_run_errors" USING btree ("run_id","row_number");--> statement-breakpoint
CREATE INDEX "sheet_sync_runs_source_idx" ON "sheet_sync_runs" USING btree ("source_id","started_at");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_sheet_source_id_sheet_sync_sources_id_fk" FOREIGN KEY ("sheet_source_id") REFERENCES "public"."sheet_sync_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leads_sheet_source_lead_id_unique" ON "leads" USING btree ("sheet_source_id","sheet_lead_id") WHERE "leads"."sheet_source_id" is not null;