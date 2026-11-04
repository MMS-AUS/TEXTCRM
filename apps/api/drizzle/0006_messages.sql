ALTER TYPE "public"."activity_type" ADD VALUE 'sms';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'email';--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direction" text NOT NULL,
	"entity_type" "activity_entity_type",
	"entity_id" uuid,
	"contact_id" uuid,
	"activity_id" uuid,
	"mailbox_user_id" uuid,
	"from_address" text NOT NULL,
	"to_addresses" text[] DEFAULT '{}'::text[] NOT NULL,
	"cc_addresses" text[] DEFAULT '{}'::text[] NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"gmail_message_id" text,
	"gmail_thread_id" text,
	"sent_at" timestamp with time zone,
	"sent_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_messages_gmail_message_unique" UNIQUE("gmail_message_id"),
	CONSTRAINT "email_messages_direction_valid" CHECK ("email_messages"."direction" in ('outbound', 'inbound'))
);
--> statement-breakpoint
CREATE TABLE "sms_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direction" text NOT NULL,
	"entity_type" "activity_entity_type",
	"entity_id" uuid,
	"contact_id" uuid,
	"activity_id" uuid,
	"from_number" text,
	"to_number" text NOT NULL,
	"content" text NOT NULL,
	"encoding" text NOT NULL,
	"segments" integer NOT NULL,
	"status" text NOT NULL,
	"status_at" timestamp with time zone,
	"error" text,
	"provider_message_id" text,
	"provider_reply_id" text,
	"in_reply_to_id" uuid,
	"sent_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_messages_provider_message_unique" UNIQUE("provider_message_id"),
	CONSTRAINT "sms_messages_provider_reply_unique" UNIQUE("provider_reply_id"),
	CONSTRAINT "sms_messages_direction_valid" CHECK ("sms_messages"."direction" in ('outbound', 'inbound'))
);
--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_mailbox_user_id_users_id_fk" FOREIGN KEY ("mailbox_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_messages_entity_idx" ON "email_messages" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "email_messages_thread_idx" ON "email_messages" USING btree ("gmail_thread_id");--> statement-breakpoint
CREATE INDEX "sms_messages_entity_idx" ON "sms_messages" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "sms_messages_contact_idx" ON "sms_messages" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "sms_messages_from_idx" ON "sms_messages" USING btree ("from_number");