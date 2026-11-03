CREATE TABLE "wallet_switches" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_owner" text NOT NULL,
	"to_owner" text NOT NULL,
	"slugs" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
