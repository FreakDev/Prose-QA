import { InvalidArgumentError } from "commander";
import type { ScenarioTagFilterExpression } from "../types/scenario.js";

function normalizeTagFilterTerm(raw: string): string {
  const term = raw.trim();
  if (!term) return "";

  const negated = term.startsWith("!");
  const tag = negated ? term.slice(1).trim() : term;
  if (!tag) {
    throw new InvalidArgumentError("negated tag filters require a tag after '!'");
  }

  return negated ? `!${tag}` : tag;
}

function splitTags(value: string): string[] {
  const tags = value
    .split(",")
    .map(normalizeTagFilterTerm)
    .filter(Boolean);

  if (tags.length === 0) {
    throw new InvalidArgumentError("tag filters require at least one tag");
  }

  return tags;
}

export function collectAllTags(
  value: string,
  previous: ScenarioTagFilterExpression = [],
): ScenarioTagFilterExpression {
  return [...previous, splitTags(value)];
}

export function collectAnyTag(
  value: string,
  previous: ScenarioTagFilterExpression = [],
): ScenarioTagFilterExpression {
  return [...previous, ...splitTags(value).map((tag) => [tag])];
}

export function mergeTagFilters(
  ...filters: (ScenarioTagFilterExpression | undefined)[]
): ScenarioTagFilterExpression | undefined {
  const merged = filters.flatMap((filter) => filter ?? []);
  return merged.length > 0 ? merged : undefined;
}
