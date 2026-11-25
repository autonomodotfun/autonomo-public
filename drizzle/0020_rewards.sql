CREATE TABLE "ref_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ref_codes_wallet_unique" UNIQUE("wallet")
);
--> statement-breakpoint
CREATE TABLE "rewards_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"gateway_id" integer NOT NULL,
	"tx" text NOT NULL,
	"payer" text NOT NULL,
	"official" boolean NOT NULL,
	"ref_code" text,
	"payer_has_pass" boolean,
	"pass_min_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rewards_calls_tx_unique" UNIQUE("tx")
);
--> statement-breakpoint
CREATE INDEX "rewards_calls_ref_created_idx" ON "rewards_calls" USING btree ("ref_code","created_at");--> statement-breakpoint
CREATE INDEX "rewards_calls_payer_created_idx" ON "rewards_calls" USING btree ("payer","created_at");--> statement-breakpoint
CREATE INDEX "rewards_calls_gateway_created_idx" ON "rewards_calls" USING btree ("gateway_id","created_at");