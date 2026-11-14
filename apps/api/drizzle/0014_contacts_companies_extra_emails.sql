ALTER TABLE "companies" ADD COLUMN "extra_emails" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "extra_emails" text[] DEFAULT '{}'::text[] NOT NULL;