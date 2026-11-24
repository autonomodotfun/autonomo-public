CREATE TABLE "router_hits" (
	"key" text NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"n" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "router_hits_key_minute_pk" PRIMARY KEY("key","minute")
);
