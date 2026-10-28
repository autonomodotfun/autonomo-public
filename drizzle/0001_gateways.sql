CREATE TABLE "gateway_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"gateway_id" integer NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"rail" text,
	"asset" text,
	"amount" text,
	"payer" text,
	"settled" boolean DEFAULT false NOT NULL,
	"tx" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateways" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"upstream_url" text NOT NULL,
	"upstream_auth_header" text,
	"upstream_auth_secret" text,
	"price_usd" numeric(18, 6) NOT NULL,
	"accept_usdg" boolean DEFAULT true NOT NULL,
	"autonomo_amount" text,
	"status" text DEFAULT 'active' NOT NULL,
	"listing" text DEFAULT 'unlisted' NOT NULL,
	"project_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gateway_calls" ADD CONSTRAINT "gateway_calls_gateway_id_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateways" ADD CONSTRAINT "gateways_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gateway_calls_gateway_created_idx" ON "gateway_calls" USING btree ("gateway_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gateways_slug_idx" ON "gateways" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "gateways_owner_idx" ON "gateways" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "gateways_listing_idx" ON "gateways" USING btree ("listing");