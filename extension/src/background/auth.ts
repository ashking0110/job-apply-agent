import { DEV_MODE } from "../config";

const TOKEN_KEY = "oauth_token";

export async function getToken(interactive: boolean = false): Promise<string | null> {
  if (DEV_MODE) return "dev-token";

  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive }, (result) => {
      if (chrome.runtime.lastError || !result) {
        console.error("[auth] getAuthToken failed:", chrome.runtime.lastError?.message, "extensionId:", chrome.runtime.id);
        resolve(null);
        return;
      }
      const token = typeof result === "string" ? result : result?.token ?? null;
      resolve(token);
    });
  });
}

export async function revokeToken(): Promise<void> {
  if (DEV_MODE) return;

  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (result) => {
      const token = typeof result === "string" ? result : result?.token ?? null;
      if (token) {
        chrome.identity.removeCachedAuthToken({ token }, () => {
          fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: "POST" }).catch(() => {});
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
}
