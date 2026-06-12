import type { LanguageModelV3Content } from "@ai-sdk/provider";
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";

export interface StepIntentCapture {
  text: string;
}

export function createStepIntentCapture(): StepIntentCapture {
  return { text: "" };
}

function extractTextFromContent(content: LanguageModelV3Content[]): string {
  return content
    .filter((part): part is Extract<LanguageModelV3Content, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
}

export function createStepIntentMiddleware(
  capture: StepIntentCapture,
): LanguageModelMiddleware {
  return {
    specificationVersion: "v3",
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate();
      capture.text = extractTextFromContent(result.content);
      return result;
    },
  };
}

function isLanguageModelV3(model: LanguageModel): model is Extract<LanguageModel, { specificationVersion: "v3" }> {
  return (
    typeof model === "object" &&
    model !== null &&
    "specificationVersion" in model &&
    model.specificationVersion === "v3"
  );
}

export function wrapModelForStepIntent(
  model: LanguageModel,
  capture: StepIntentCapture,
): LanguageModel {
  if (!isLanguageModelV3(model)) {
    return model;
  }
  return wrapLanguageModel({
    model,
    middleware: createStepIntentMiddleware(capture),
  });
}
