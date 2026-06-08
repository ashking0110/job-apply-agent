import { getToken } from "./auth";
import { DraftState } from "../messages/types";
import { BACKEND_URL } from "../config";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken(false);
  if (!token) throw new ApiError(401, "Not authenticated");

  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string };
    throw new ApiError(response.status, body.error ?? `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export interface Profile {
  id: string;
  resumeContent: string;
}

export async function getProfile(): Promise<Profile | null> {
  try {
    return await apiFetch<Profile>("/profile");
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function upsertProfile(resumeContent: string): Promise<Profile> {
  return apiFetch<Profile>("/profile", {
    method: "PUT",
    body: JSON.stringify({ resumeContent }),
  });
}

export async function requestDraft(params: {
  jobDescription: string;
  company: string;
  roleTitle: string;
  jobAttributes?: Record<string, unknown>;
}): Promise<DraftState> {
  const result = await apiFetch<{
    applicationId: string;
    variantId: string;
    company: string;
    roleTitle: string;
    resumeContent: string;
    coverLetterContent: string;
  }>("/draft", {
    method: "POST",
    body: JSON.stringify(params),
  });

  return {
    applicationId: result.applicationId,
    variantId: result.variantId,
    company: result.company,
    roleTitle: result.roleTitle,
    resumeContent: result.resumeContent,
    coverLetterContent: result.coverLetterContent,
  };
}

export async function confirmSubmit(
  applicationId: string,
  variantId: string
): Promise<{ submittedAt: string }> {
  return apiFetch<{ submittedAt: string }>(`/applications/${applicationId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ variantId }),
  });
}
