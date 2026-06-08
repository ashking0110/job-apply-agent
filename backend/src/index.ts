import "dotenv/config";
import express from "express";
import { requireAuth } from "./middleware/auth";
import { profileRouter } from "./routes/profile";
import { draftRouter } from "./routes/draft";
import { confirmRouter } from "./routes/confirm";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

// All routes below require a valid Google OAuth token
app.use("/profile", requireAuth, profileRouter);
app.use("/draft", requireAuth, draftRouter);
app.use("/applications", requireAuth, confirmRouter);

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`Backend listening on :${PORT}`));
