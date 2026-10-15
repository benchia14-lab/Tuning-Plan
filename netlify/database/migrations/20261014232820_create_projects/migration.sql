CREATE TABLE "projects" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"snap" jsonb NOT NULL,
	"period_count" integer DEFAULT 0 NOT NULL,
	"system_count" integer DEFAULT 0 NOT NULL,
	"password_hash" text,
	"password_salt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL
);
