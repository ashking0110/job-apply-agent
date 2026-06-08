import { Request, Response, NextFunction } from "express";

interface GoogleTokenInfo {
  sub: string;
  email: string;
  exp: string;
  aud: string;
  error_description?: string;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Dev bypass: set DEV_USER_ID in .env to skip Google OAuth during local testing.
  // Never set this in production.
  const devUserId = process.env.DEV_USER_ID;
  if (devUserId) {
    req.user = { id: devUserId, email: "dev@local" };
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing Authorization header" });
    return;
  }

  const token = authHeader.slice(7);

  let info: GoogleTokenInfo;
  try {
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`);
    info = (await response.json()) as GoogleTokenInfo;
    if (info.error_description) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }
  } catch {
    res.status(401).json({ error: "Token verification failed" });
    return;
  }

  if (Date.now() / 1000 > parseInt(info.exp, 10)) {
    res.status(401).json({ error: "Token expired" });
    return;
  }

  // When GOOGLE_CLIENT_ID is set, verify the token was issued for this app.
  const expectedAud = process.env.GOOGLE_CLIENT_ID;
  if (expectedAud && info.aud !== expectedAud) {
    res.status(401).json({ error: "Token audience mismatch" });
    return;
  }

  req.user = { id: info.sub, email: info.email };
  next();
}
