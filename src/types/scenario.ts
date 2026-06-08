export interface ScenarioFrontmatter {
  name: string;
  tags?: string[];
  auth?: string;
  url?: string;
  /** Skill names to load into the agent prompt when this scenario runs. */
  skills?: string[];
  /** When true, scenario is only included via body links — never run directly. */
  partial?: boolean;
}

export interface Scenario {
  filePath: string;
  frontmatter: ScenarioFrontmatter;
  /** Skill names from this scenario and any linked scenario includes. */
  skills: string[];
  goal: string;
  steps: string;
  then: string[];
  rawCheckpoints: string[];
  checkpoints: ParsedCheckpoint[];
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
