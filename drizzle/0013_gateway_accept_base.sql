ALTER TABLE "gateways" ADD COLUMN "accept_base" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- An API that only takes $AUTONOMO stays that way: Base is USDC, so it starts off for those.
UPDATE "gateways" SET "accept_base" = false WHERE "accept_usdg" = false;
