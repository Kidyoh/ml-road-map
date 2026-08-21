CREATE TYPE "public"."node_status" AS ENUM('planned', 'published');--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "status" "node_status" DEFAULT 'published' NOT NULL;