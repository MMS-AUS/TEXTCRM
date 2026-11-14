ALTER TABLE "lead_system_requirements" DROP CONSTRAINT "lead_system_requirements_counts_non_negative";--> statement-breakpoint
ALTER TABLE "leads" DROP CONSTRAINT "leads_secondary_email_lowercase";--> statement-breakpoint
ALTER TABLE "leads" DROP CONSTRAINT "leads_secondary_email_format";--> statement-breakpoint
ALTER TABLE "lead_system_requirements" DROP CONSTRAINT "lead_system_requirements_inverter_id_hardware_inverters_id_fk";
--> statement-breakpoint
DROP INDEX "leads_platform_idx";--> statement-breakpoint
ALTER TABLE "lead_system_requirements" DROP COLUMN "inverter_id";--> statement-breakpoint
ALTER TABLE "lead_system_requirements" DROP COLUMN "inverter_count";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "platform";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "secondary_email";--> statement-breakpoint
ALTER TABLE "lead_system_requirements" ADD CONSTRAINT "lead_system_requirements_counts_non_negative" CHECK (coalesce("lead_system_requirements"."panel_count", 0) >= 0 and coalesce("lead_system_requirements"."battery_count", 0) >= 0);