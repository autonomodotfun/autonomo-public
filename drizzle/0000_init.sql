CREATE TABLE "endpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"url" text NOT NULL,
	"method" text DEFAULT 'GET' NOT NULL,
	"type" text DEFAULT 'http' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"network" text,
	"asset" text,
	"amount" text,
	"price_usd" numeric(18, 6),
	"pay_to" text,
	"scheme" text,
	"facilitator" text NOT NULL,
	"x402_version" integer,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"bazaar_info" jsonb,
	"calls_30d" integer DEFAULT 0 NOT NULL,
	"payers_30d" integer DEFAULT 0 NOT NULL,
	"last_called_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_status" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"website" text,
	"github" text,
	"twitter" text,
	"docs" text,
	"logo_url" text,
	"host" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"networks" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"source" text NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"endpoint_count" integer DEFAULT 0 NOT NULL,
	"calls_30d" integer DEFAULT 0 NOT NULL,
	"payers_30d" integer DEFAULT 0 NOT NULL,
	"min_price_usd" numeric(18, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(description, '')), 'B')) STORED
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"website" text NOT NULL,
	"github" text,
	"twitter" text,
	"endpoint_url" text,
	"contact" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"project_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "endpoints" ADD CONSTRAINT "endpoints_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "endpoints_url_method_idx" ON "endpoints" USING btree ("url","method");--> statement-breakpoint
CREATE INDEX "endpoints_project_idx" ON "endpoints" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "endpoints_network_idx" ON "endpoints" USING btree ("network");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_slug_idx" ON "projects" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_host_idx" ON "projects" USING btree ("host");--> statement-breakpoint
CREATE INDEX "projects_category_idx" ON "projects" USING btree ("category");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_search_idx" ON "projects" USING gin ("search");--> statement-breakpoint
CREATE INDEX "submissions_status_idx" ON "submissions" USING btree ("status");