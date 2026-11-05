CREATE TABLE "gloam_payments" (
	"tx" text PRIMARY KEY NOT NULL,
	"quote_id" text NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"locked_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gloam_quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"gateway_id" integer NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"pay_to" text NOT NULL,
	"gross" text NOT NULL,
	"price" text NOT NULL,
	"requester" text NOT NULL,
	"open" boolean DEFAULT true NOT NULL,
	"tx" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gloam_quotes" ADD CONSTRAINT "gloam_quotes_gateway_id_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gloam_quotes_open_amount_idx" ON "gloam_quotes" USING btree ("pay_to","gross") WHERE "gloam_quotes"."open";--> statement-breakpoint
CREATE INDEX "gloam_quotes_requester_idx" ON "gloam_quotes" USING btree ("requester","issued_at");--> statement-breakpoint
CREATE INDEX "gloam_quotes_issued_idx" ON "gloam_quotes" USING btree ("issued_at");