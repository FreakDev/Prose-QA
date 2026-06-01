import { z } from "zod";

export const FlakeDiagnosisSchema = z.object({
  type: z.enum([
    "false_negative",
    "false_positive",
    "timing_flake",
    "agent_drift",
    "product",
  ]),
  confidence: z.enum(["high", "medium", "low"]),
  explanation: z.string(),
});

export const ScenarioFixProposalSchema = z.object({
  shouldEditScenario: z.boolean(),
  rationale: z.string(),
  changes: z.array(z.string()),
  revisedMarkdown: z.string().nullable().optional(),
  flakeDiagnosis: FlakeDiagnosisSchema.optional(),
});

export type FlakeDiagnosis = z.infer<typeof FlakeDiagnosisSchema>;
export type ScenarioFixProposal = z.infer<typeof ScenarioFixProposalSchema>;

export function extractScenarioFixProposal(text: string): ScenarioFixProposal | null {
  const jsonBlock = /```(?:json)?\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  const candidates: string[] = [];

  while ((match = jsonBlock.exec(text)) !== null) {
    candidates.push(match[1]!.trim());
  }
  candidates.push(text.trim());

  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const result = ScenarioFixProposalSchema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
      // continue
    }
  }

  const inline =
    /\{[\s\S]*"shouldEditScenario"\s*:\s*(?:true|false)[\s\S]*\}/.exec(text);
  if (inline) {
    try {
      const parsed = JSON.parse(inline[0]) as unknown;
      const result = ScenarioFixProposalSchema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
      // continue
    }
  }

  return null;
}
