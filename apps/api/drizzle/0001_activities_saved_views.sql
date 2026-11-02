CREATE TYPE "public"."activity_entity_type" AS ENUM('lead', 'contact', 'project', 'ticket');--> statement-breakpoint
CREATE TYPE "public"."activity_type" AS ENUM('note', 'call', 'meeting', 'task', 'system');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "activity_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"type" "activity_type" NOT NULL,
	"subject" text,
	"body" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"direction" text,
	"outcome" text,
	"duration_minutes" integer,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"assigned_user_id" uuid,
	"metadata" jsonb,
	"author_user_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_duration_non_negative" CHECK ("activities"."duration_minutes" is null or "activities"."duration_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"page" text NOT NULL,
	"name" text NOT NULL,
	"search" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_entity_idx" ON "activities" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activities_open_tasks_idx" ON "activities" USING btree ("assigned_user_id","due_at") WHERE "activities"."type" = 'task' and "activities"."completed_at" is null and "activities"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "saved_views_user_page_idx" ON "saved_views" USING btree ("user_id","page");