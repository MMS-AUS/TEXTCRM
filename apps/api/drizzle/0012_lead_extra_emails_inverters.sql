CREATE TABLE "lead_system_inverters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"inverter_id" uuid NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"type" text DEFAULT 'grid' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_system_inverters_count_positive" CHECK ("lead_system_inverters"."count" > 0),
	CONSTRAINT "lead_system_inverters_type" CHECK ("lead_system_inverters"."type" in ('grid', 'hybrid'))
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "extra_emails" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "full_name" text GENERATED ALWAYS AS (btrim(first_name || ' ' || coalesce(last_name, ''))) STORED;--> statement-breakpoint
ALTER TABLE "lead_system_inverters" ADD CONSTRAINT "lead_system_inverters_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_system_inverters" ADD CONSTRAINT "lead_system_inverters_inverter_id_hardware_inverters_id_fk" FOREIGN KEY ("inverter_id") REFERENCES "public"."hardware_inverters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_system_inverters_lead_idx" ON "lead_system_inverters" USING btree ("lead_id","position");--> statement-breakpoint
-- Data: the old single inverter becomes the first row of the new inverters table.
INSERT INTO "lead_system_inverters" ("lead_id", "position", "inverter_id", "count", "type")
SELECT "lead_id", 0, "inverter_id", COALESCE(NULLIF("inverter_count", 0), 1), 'grid'
FROM "lead_system_requirements" WHERE "inverter_id" IS NOT NULL;
--> statement-breakpoint
-- Data: a secondary email becomes an extra-email tag.
UPDATE "leads" SET "extra_emails" = ARRAY["secondary_email"]
WHERE "secondary_email" IS NOT NULL AND "secondary_email" IS DISTINCT FROM "email";
--> statement-breakpoint
-- Data: Lead Platform folds into Lead Source. Platform choices become Lead Source choices, and a
-- lead with a platform but no source takes the platform as its source.
INSERT INTO "options" ("list_id", "value", "label", "sort_order")
SELECT (SELECT "id" FROM "option_lists" WHERE "key" = 'leadSources'), po."value", po."label", 1000 + po."sort_order"
FROM "options" po
JOIN "option_lists" pl ON pl."id" = po."list_id" AND pl."key" = 'platforms'
WHERE EXISTS (SELECT 1 FROM "option_lists" WHERE "key" = 'leadSources')
ON CONFLICT ("list_id", "value") DO NOTHING;
--> statement-breakpoint
UPDATE "leads" SET "source" = "platform" WHERE "source" IS NULL AND "platform" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "option_lists" WHERE "key" = 'platforms';
