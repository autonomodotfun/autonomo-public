CREATE TABLE "router_probe_inputs" (
	"id" serial PRIMARY KEY NOT NULL,
	"capability" text NOT NULL,
	"key" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"slug" text NOT NULL,
	"payer" text DEFAULT '' NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "router_probe_inputs_one_idx" ON "router_probe_inputs" USING btree ("capability","key","slug");--> statement-breakpoint
CREATE INDEX "router_probe_inputs_capability_at_idx" ON "router_probe_inputs" USING btree ("capability","at");