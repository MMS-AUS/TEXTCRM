CREATE TABLE "gmail_sync_state" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"history_id" text,
	"watch_expires_at" timestamp with time zone,
	"last_push_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_sync_error" text,
	"last_stored" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "body_html" text;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "message_id_header" text;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "in_reply_to_id" uuid;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "attachment_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gmail_sync_state" ADD CONSTRAINT "gmail_sync_state_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_messages_contact_idx" ON "email_messages" USING btree ("contact_id");