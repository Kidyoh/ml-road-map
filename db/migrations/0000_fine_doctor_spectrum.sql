CREATE TYPE "public"."artifact_kind" AS ENUM('link', 'notebook', 'repo', 'text');--> statement-breakpoint
CREATE TYPE "public"."entry_track" AS ENUM('beginner', 'developer', 'practitioner');--> statement-breakpoint
CREATE TYPE "public"."node_state" AS ENUM('hidden', 'fogged', 'open', 'in_progress', 'passed');--> statement-breakpoint
CREATE TYPE "public"."self_rating" AS ENUM('got_it', 'partial', 'no_idea');--> statement-breakpoint
CREATE TYPE "public"."struggle_signal" AS ENUM('time_to_first_check', 'revealed_before_attempt', 'node_abandoned', 'thin_reflection', 'reopened_after_pass');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"node_id" text NOT NULL,
	"kind" "artifact_kind" NOT NULL,
	"url_or_body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_state" (
	"user_id" text NOT NULL,
	"checklist_item_id" text NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"checked_at" timestamp with time zone,
	CONSTRAINT "checklist_state_user_id_checklist_item_id_pk" PRIMARY KEY("user_id","checklist_item_id")
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"node_id" text NOT NULL,
	"parent_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_checklist" (
	"id" text PRIMARY KEY NOT NULL,
	"node_id" text NOT NULL,
	"item" text NOT NULL,
	"order_index" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_prereqs" (
	"node_id" text NOT NULL,
	"prereq_id" text NOT NULL,
	CONSTRAINT "node_prereqs_node_id_prereq_id_pk" PRIMARY KEY("node_id","prereq_id")
);
--> statement-breakpoint
CREATE TABLE "node_progress" (
	"user_id" text NOT NULL,
	"node_id" text NOT NULL,
	"state" "node_state" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "node_progress_user_id_node_id_pk" PRIMARY KEY("user_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "node_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"node_id" text NOT NULL,
	"prompt" text NOT NULL,
	"answer_key" text NOT NULL,
	"order_index" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"phase" integer NOT NULL,
	"order_index" integer NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"goal" text NOT NULL,
	"content_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nodes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "question_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"question_id" text NOT NULL,
	"response" text,
	"self_rating" "self_rating",
	"revealed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reflections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"node_id" text NOT NULL,
	"body" text NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "struggle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"node_id" text NOT NULL,
	"signal" "struggle_signal" NOT NULL,
	"value" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"email_verified" timestamp with time zone,
	"image" text,
	"entry_track" "entry_track",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_state" ADD CONSTRAINT "checklist_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_state" ADD CONSTRAINT "checklist_state_checklist_item_id_node_checklist_id_fk" FOREIGN KEY ("checklist_item_id") REFERENCES "public"."node_checklist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_checklist" ADD CONSTRAINT "node_checklist_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_prereqs" ADD CONSTRAINT "node_prereqs_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_prereqs" ADD CONSTRAINT "node_prereqs_prereq_id_nodes_id_fk" FOREIGN KEY ("prereq_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_progress" ADD CONSTRAINT "node_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_progress" ADD CONSTRAINT "node_progress_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_questions" ADD CONSTRAINT "node_questions_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_attempts" ADD CONSTRAINT "question_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_attempts" ADD CONSTRAINT "question_attempts_question_id_node_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."node_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "struggle_events" ADD CONSTRAINT "struggle_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "struggle_events" ADD CONSTRAINT "struggle_events_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "node_checklist_node_order_idx" ON "node_checklist" USING btree ("node_id","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "node_questions_node_order_idx" ON "node_questions" USING btree ("node_id","order_index");