export interface ScenarioFrontmatter {
  name: string;
  tags?: string[];
  auth?: string;
  baseUrl?: string;
}

export interface Scenario {
  filePath: string;
  frontmatter: ScenarioFrontmatter;
  goal: string;
  steps: string;
  then: string[];
  rawCheckpoints: string[];
}

export type CheckpointKind =
  | "url_contains"
  | "page_shows"
  | "semantic"
  | "unknown";

export interface ParsedCheckpoint {
  raw: string;
  kind: CheckpointKind;
  value?: string;
}
