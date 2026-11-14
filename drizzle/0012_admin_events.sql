CREATE TABLE "admin_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"detail" text,
	"note" text,
	"gateway_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "admin_events_created_idx" ON "admin_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_events_gateway_idx" ON "admin_events" USING btree ("gateway_id");