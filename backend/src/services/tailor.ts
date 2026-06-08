import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export interface TailoredDraft {
  resumeContent: string;
  coverLetterContent: string;
}

export async function tailorToJobDescription(
  profileResume: string,
  jobDescription: string,
  company: string,
  roleTitle: string
): Promise<TailoredDraft> {
  const systemPrompt = `You are an expert resume and cover letter writer.
Given a candidate's base resume and a job description, produce:
1. A tailored resume that emphasizes relevant experience and skills for this specific role.
2. A concise, personalized cover letter (3–4 paragraphs).

Respond with valid JSON matching this schema exactly:
{
  "resumeContent": "<tailored resume as plain text>",
  "coverLetterContent": "<cover letter as plain text>"
}`;

  const userPrompt = `Company: ${company}
Role: ${roleTitle}

Job Description:
${jobDescription}

Candidate's Base Resume:
${profileResume}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const raw = message.content[0];
  if (raw.type !== "text") throw new Error("Unexpected response type from LLM");

  const jsonMatch = raw.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in LLM response");

  const parsed = JSON.parse(jsonMatch[0]) as TailoredDraft;
  if (!parsed.resumeContent || !parsed.coverLetterContent) {
    throw new Error("LLM response missing required fields");
  }

  return parsed;
}
