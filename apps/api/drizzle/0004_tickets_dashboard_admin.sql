CREATE TABLE "company_profile" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"legal_name" text NOT NULL,
	"trading_name" text,
	"abn" text,
	"phone" text,
	"email" text,
	"website" text,
	"street_address" text,
	"suburb" text,
	"state" text,
	"postcode" text,
	"electrical_licence" text,
	"cec_accreditation" text,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_profile_single_row" CHECK ("company_profile"."id")
);
--> statement-breakpoint
ALTER TABLE "import_jobs" DROP CONSTRAINT "import_jobs_target_valid";--> statement-breakpoint
ALTER TABLE "company_profile" ADD CONSTRAINT "company_profile_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_converted_at_idx" ON "leads" USING btree ("converted_at");--> statement-breakpoint
CREATE INDEX "project_installation_completed_idx" ON "project_installation" USING btree ("completed_date","booking_date");--> statement-breakpoint
CREATE INDEX "projects_sale_date_idx" ON "projects" USING btree ("sale_date");--> statement-breakpoint
CREATE INDEX "tickets_open_idx" ON "tickets" USING btree ("closed_at","priority","created_at");--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_target_valid" CHECK ("import_jobs"."target" in ('leads', 'contacts', 'panels', 'inverters', 'batteries'));