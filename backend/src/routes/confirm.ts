import { Router, Request, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { applications, profiles } from "../db/schema";
import { assertTransition } from "../db/state-machine";
import { eq } from "drizzle-orm";

export const confirmRouter = Router();

const ConfirmBody = z.object({
  variantId: z.string().uuid(),
});

// POST /applications/:id/confirm
// The §2.1 human-confirm boundary. The only path that transitions an application
// to submitted and freezes submitted_variant_id. Verifies ownership before acting.
confirmRouter.post("/:id/confirm", async (req: Request, res: Response) => {
  const applicationId = req.params.id as string;
  const parsed = ConfirmBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { variantId } = parsed.data;

  // Join with profiles to verify ownership in one query
  const [row] = await db
    .select({
      id: applications.id,
      state: applications.state,
      submittedVariantId: applications.submittedVariantId,
      ownerUserId: profiles.userId,
    })
    .from(applications)
    .innerJoin(profiles, eq(applications.profileId, profiles.id))
    .where(eq(applications.id, applicationId))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Application not found" });
    return;
  }

  if (row.ownerUserId !== req.user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Guard: only ready_for_review → submitted is valid here
  assertTransition(row.state, "submitted");

  // Guard: submitted_variant_id must never already be set
  if (row.submittedVariantId !== null) {
    res.status(409).json({ error: "Application already submitted" });
    return;
  }

  const [updated] = await db
    .update(applications)
    .set({
      state: "submitted",
      submittedVariantId: variantId,
      submittedAt: new Date(),
    })
    .where(eq(applications.id, applicationId))
    .returning();

  res.json({
    applicationId: updated.id,
    state: updated.state,
    submittedVariantId: updated.submittedVariantId,
    submittedAt: updated.submittedAt,
  });
});
