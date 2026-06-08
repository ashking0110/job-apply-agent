import { pgTable, text, timestamp, pgEnum, uuid } from "drizzle-orm/pg-core";

export const applicationStateEnum = pgEnum("application_state", [
  "draft",
  "ready_for_review",
  "submitted",
  "responded",
  "rejected",
  "ghosted",
  "interview",
]);

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().unique(),
  resumeContent: text("resume_content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// variants is defined before applications because applications references it via FK
export const variants = pgTable("variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: uuid("application_id").notNull(),
  resumeContent: text("resume_content").notNull(),
  coverLetterContent: text("cover_letter_content").notNull(),
  // No updatedAt — variants are immutable. Re-tailoring inserts a new row.
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const applications = pgTable("applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id),
  jdSnapshot: text("jd_snapshot").notNull(),
  company: text("company").notNull(),
  roleTitle: text("role_title").notNull(),
  // Structured job attributes for the correlation engine
  jobAttributes: text("job_attributes").notNull().default("{}"),
  state: applicationStateEnum("state").notNull().default("draft"),
  // Set once at ready_for_review → submitted. Never changed after that.
  submittedVariantId: uuid("submitted_variant_id").references(() => variants.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  submittedAt: timestamp("submitted_at"),
  respondedAt: timestamp("responded_at"),
  rejectedAt: timestamp("rejected_at"),
  ghostedAt: timestamp("ghosted_at"),
  interviewAt: timestamp("interview_at"),
});
