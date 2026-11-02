CREATE TABLE "agent_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"surface" text NOT NULL,
	"turns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"surface" text NOT NULL,
	"subject" text NOT NULL,
	"outcome" text NOT NULL,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"receipts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_conversations_updated_idx" ON "agent_conversations" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "agent_questions_subject_created_idx" ON "agent_questions" USING btree ("subject","created_at");--> statement-breakpoint
CREATE INDEX "agent_questions_created_idx" ON "agent_questions" USING btree ("created_at");