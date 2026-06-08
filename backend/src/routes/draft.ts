import { Router, Request, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { applications, profiles, variants } from "../db/schema";
import { tailorToJobDescription } from "../services/tailor";
import { eq } from "drizzle-orm";

export const draftRouter = Router();

const CreateDraftBody = z.object({
  jobDescription: z.string().min(1),
  company: z.string().default("Unknown company"),
  roleTitle: z.string().min(1),
  jobAttributes: z.record(z.string(), z.unknown()).optional().default({}),
});

// POST /draft
// Looks up the authenticated user's profile, tailors documents, and transitions
// the new application to ready_for_review. profileId is derived from the auth token.
draftRouter.post("/", async (req: Request, res: Response) => {
  const parsed = CreateDraftBody.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    res.status(400).json({ error: msg });
    return;
  }

  const { jobDescription, company, roleTitle, jobAttributes } = parsed.data;

  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, req.user.id))
    .limit(1);

  if (!profile) {
    res.status(404).json({ error: "Profile not found — set up your resume first" });
    return;
  }

  const [application] = await db
    .insert(applications)
    .values({
      profileId: profile.id,
      jdSnapshot: jobDescription,
      company,
      roleTitle,
      jobAttributes: JSON.stringify(jobAttributes),
      state: "draft",
    })
    .returning();

  const draft = await tailorToJobDescription(
    profile.resumeContent,
    jobDescription,
    company,
    roleTitle
  );

  const [variant] = await db
    .insert(variants)
    .values({
      applicationId: application.id,
      resumeContent: draft.resumeContent,
      coverLetterContent: draft.coverLetterContent,
    })
    .returning();

  // Transition: draft → ready_for_review
  const [updated] = await db
    .update(applications)
    .set({ state: "ready_for_review" })
    .where(eq(applications.id, application.id))
    .returning();

  res.status(201).json({
    applicationId: updated.id,
    state: updated.state,
    variantId: variant.id,
    company: updated.company,
    roleTitle: updated.roleTitle,
    resumeContent: variant.resumeContent,
    coverLetterContent: variant.coverLetterContent,
  });
});
