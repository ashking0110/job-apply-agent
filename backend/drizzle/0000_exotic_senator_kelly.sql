CREATE TYPE "public"."application_state" AS ENUM('draft', 'ready_for_review', 'submitted', 'responded', 'rejected', 'ghosted', 'interview');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"jd_snapshot" text NOT NULL,
	"company" text NOT NULL,
	"role_title" text NOT NULL,
	"job_attributes" text DEFAULT '{}' NOT NULL,
	"state" "application_state" DEFAULT 'draft' NOT NULL,
	"submitted_variant_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"submitted_at" timestamp,
	"responded_at" timestamp,
	"rejected_at" timestamp,
	"ghosted_at" timestamp,
	"interview_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"resume_content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"resume_content" text NOT NULL,
	"cover_letter_content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_submitted_variant_id_variants_id_fk" FOREIGN KEY ("submitted_variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;