ALTER TABLE "project_system_design" DROP CONSTRAINT "project_system_design_counts_non_negative";--> statement-breakpoint
ALTER TABLE "project_system_design" DROP CONSTRAINT "project_system_design_inverter_id_hardware_inverters_id_fk";
--> statement-breakpoint
ALTER TABLE "project_system_design" DROP COLUMN "inverter_id";--> statement-breakpoint
ALTER TABLE "project_system_design" DROP COLUMN "inverter_count";--> statement-breakpoint
ALTER TABLE "project_system_design" ADD CONSTRAINT "project_system_design_counts_non_negative" CHECK (coalesce("project_system_design"."panel_count", 0) >= 0 and coalesce("project_system_design"."battery_count", 0) >= 0);