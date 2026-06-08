import { Router, Request, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { profiles } from "../db/schema";
import { eq } from "drizzle-orm";

export const profileRouter = Router();

profileRouter.get("/", async (req: Request, res: Response) => {
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, req.user.id))
    .limit(1);

  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  res.json({ id: profile.id, resumeContent: profile.resumeContent });
});

const UpsertProfileBody = z.object({
  resumeContent: z.string().min(1),
});

// PUT /profile — create or update the authenticated user's profile
profileRouter.put("/", async (req: Request, res: Response) => {
  const parsed = UpsertProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { resumeContent } = parsed.data;

  const [existing] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, req.user.id))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(profiles)
      .set({ resumeContent, updatedAt: new Date() })
      .where(eq(profiles.userId, req.user.id))
      .returning();
    res.json({ id: updated.id, resumeContent: updated.resumeContent });
  } else {
    const [created] = await db
      .insert(profiles)
      .values({ userId: req.user.id, resumeContent })
      .returning();
    res.status(201).json({ id: created.id, resumeContent: created.resumeContent });
  }
});
