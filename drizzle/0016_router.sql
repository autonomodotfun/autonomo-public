CREATE TABLE "router_blocked_payers" (
	"payer" text PRIMARY KEY NOT NULL,
	"until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "router_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"valid" boolean NOT NULL,
	"ms" integer,
	"kind" text NOT NULL,
	"payer" text DEFAULT '' NOT NULL,
	"settled" boolean DEFAULT false NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"counted" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "router_routes" (
	"id" text PRIMARY KEY NOT NULL,
	"capability" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"slug" text NOT NULL,
	"tried" jsonb NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	"used" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "router_slashes" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"pay_to" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "router_uptime" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"up" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gateways" ADD COLUMN "route_capability" text;--> statement-breakpoint
ALTER TABLE "gateways" ADD COLUMN "route_path" text;--> statement-breakpoint
ALTER TABLE "gateways" ADD COLUMN "route_mapping" jsonb;--> statement-breakpoint
ALTER TABLE "gateways" ADD COLUMN "route_format_ok" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gateways" ADD COLUMN "route_listed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "router_calls_slug_at_idx" ON "router_calls" USING btree ("slug","at");--> statement-breakpoint
CREATE INDEX "router_slashes_slug_idx" ON "router_slashes" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "router_slashes_pay_to_idx" ON "router_slashes" USING btree ("pay_to");--> statement-breakpoint
CREATE INDEX "router_uptime_slug_at_idx" ON "router_uptime" USING btree ("slug","at");