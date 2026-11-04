CREATE TABLE "burn_receipts" (
	"tx" text NOT NULL,
	"log_index" integer NOT NULL,
	"kind" text NOT NULL,
	"burned" text NOT NULL,
	"usdg_in" text,
	"block_number" bigint NOT NULL,
	"burned_at" timestamp with time zone NOT NULL,
	CONSTRAINT "burn_receipts_tx_log_index_pk" PRIMARY KEY("tx","log_index")
);
--> statement-breakpoint
CREATE INDEX "burn_receipts_block_idx" ON "burn_receipts" USING btree ("block_number");