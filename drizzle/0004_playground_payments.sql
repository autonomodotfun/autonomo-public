CREATE TABLE "playground_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"visitor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "playground_payments_visitor_created_idx" ON "playground_payments" USING btree ("visitor","created_at");