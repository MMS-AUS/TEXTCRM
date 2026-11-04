CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"user_id" uuid,
	"account_id" text,
	"account_name" text,
	"secrets" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"connected_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connections_provider_valid" CHECK ("integration_connections"."provider" in ('gmail', 'xero', 'messagemedia')),
	CONSTRAINT "integration_connections_status_valid" CHECK ("integration_connections"."status" in ('connected', 'needs_tenant', 'expired', 'error'))
);
--> statement-breakpoint
CREATE TABLE "integration_oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"user_id" uuid NOT NULL,
	"code_verifier" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_oauth_states" ADD CONSTRAINT "integration_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_user_unique" ON "integration_connections" USING btree ("provider","user_id") WHERE "integration_connections"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_org_unique" ON "integration_connections" USING btree ("provider") WHERE "integration_connections"."user_id" is null;--> statement-breakpoint
CREATE INDEX "integration_oauth_states_expires_idx" ON "integration_oauth_states" USING btree ("expires_at");