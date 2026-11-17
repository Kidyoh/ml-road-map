ALTER TYPE "public"."struggle_signal" ADD VALUE 'exam_question_missed';--> statement-breakpoint
CREATE TABLE "certificates" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificates_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "exam_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"exam_id" text NOT NULL,
	"paper" jsonb NOT NULL,
	"pass_mark" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"responses" jsonb,
	"correct" integer,
	"passed" boolean
);
--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exam_attempts_user_exam_idx" ON "exam_attempts" USING btree ("user_id","exam_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_attempts_one_open_idx" ON "exam_attempts" USING btree ("user_id","exam_id") WHERE "exam_attempts"."submitted_at" is null;