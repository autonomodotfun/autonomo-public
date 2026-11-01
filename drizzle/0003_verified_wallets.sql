CREATE TABLE "verified_wallets" (
	"owner" text PRIMARY KEY NOT NULL,
	"tokens" integer NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
