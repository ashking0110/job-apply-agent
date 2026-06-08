import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

// Mirrors the schema in draft.ts — profileId is now derived from the auth token
const CreateDraftBody = z.object({
  jobDescription: z.string().min(1),
  company: z.string().min(1),
  roleTitle: z.string().min(1),
  jobAttributes: z.record(z.string(), z.unknown()).optional().default({}),
});

describe("POST /draft — request body validation", () => {
  it("accepts a valid body", () => {
    const result = CreateDraftBody.safeParse({
      jobDescription: "We are looking for a TypeScript engineer.",
      company: "Acme",
      roleTitle: "Software Engineer",
    });
    assert.equal(result.success, true);
  });

  it("defaults jobAttributes to empty object when omitted", () => {
    const result = CreateDraftBody.safeParse({
      jobDescription: "JD text",
      company: "Acme",
      roleTitle: "Engineer",
    });
    assert.equal(result.success, true);
    if (result.success) assert.deepEqual(result.data.jobAttributes, {});
  });

  it("accepts structured jobAttributes", () => {
    const result = CreateDraftBody.safeParse({
      jobDescription: "JD text",
      company: "Acme",
      roleTitle: "Engineer",
      jobAttributes: { seniority: "senior", remote: true, stack: ["TypeScript", "Postgres"] },
    });
    assert.equal(result.success, true);
  });

  it("rejects empty strings", () => {
    const result = CreateDraftBody.safeParse({
      jobDescription: "",
      company: "",
      roleTitle: "",
    });
    assert.equal(result.success, false);
  });

  it("rejects missing required fields", () => {
    const result = CreateDraftBody.safeParse({ company: "Acme" });
    assert.equal(result.success, false);
  });
});
