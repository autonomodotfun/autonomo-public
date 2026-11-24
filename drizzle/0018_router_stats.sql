CREATE TABLE "router_stats" (
	"slug" text PRIMARY KEY NOT NULL,
	"pay_to" text NOT NULL,
	"measured" integer NOT NULL,
	"valid" integer NOT NULL,
	"median_ms" double precision,
	"uptime" double precision NOT NULL,
	"last_slash" timestamp with time zone,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "router_stats_pay_to_idx" ON "router_stats" USING btree ("pay_to");