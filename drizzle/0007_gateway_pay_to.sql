ALTER TABLE "gateways" ADD COLUMN "pay_to" text;--> statement-breakpoint
ALTER TABLE "wallet_switches" ADD COLUMN "kind" text DEFAULT 'owner' NOT NULL;