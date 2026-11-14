CREATE TABLE "project_system_inverters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"inverter_id" uuid NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"type" text DEFAULT 'grid' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_system_inverters_count_positive" CHECK ("project_system_inverters"."count" > 0),
	CONSTRAINT "project_system_inverters_type" CHECK ("project_system_inverters"."type" in ('grid', 'hybrid'))
);
--> statement-breakpoint
ALTER TABLE "project_system_inverters" ADD CONSTRAINT "project_system_inverters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_system_inverters" ADD CONSTRAINT "project_system_inverters_inverter_id_hardware_inverters_id_fk" FOREIGN KEY ("inverter_id") REFERENCES "public"."hardware_inverters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_system_inverters_project_idx" ON "project_system_inverters" USING btree ("project_id","position");--> statement-breakpoint
-- Data: a project's single inverter becomes the first row of the new inverters table.
INSERT INTO "project_system_inverters" ("project_id", "position", "inverter_id", "count", "type")
SELECT "project_id", 0, "inverter_id", COALESCE(NULLIF("inverter_count", 0), 1), 'grid'
FROM "project_system_design" WHERE "inverter_id" IS NOT NULL;
