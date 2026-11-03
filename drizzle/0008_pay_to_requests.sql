CREATE TABLE "pay_to_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"pay_to" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pay_to_requests_pending_idx" ON "pay_to_requests" USING btree ("owner") WHERE "pay_to_requests"."status" = 'pending';