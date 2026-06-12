export type ActionOverlayCategory = "mutation" | "navigation" | "observation";

export interface ParsedAgentBrowserAction {
  category: ActionOverlayCategory;
  subcommand: string;
  /** Human-readable label for HUD (never includes fill values). */
  label: string;
  /** Selector passed to agent-browser get box / highlight, if any. */
  target?: string;
}

const MUTATION_COMMANDS = new Set([
  "click",
  "fill",
  "select",
  "check",
  "uncheck",
  "press",
  "hover",
  "drag",
  "upload",
  "type",
]);

const NAVIGATION_COMMANDS = new Set([
  "open",
  "goto",
  "navigate",
  "back",
  "forward",
  "reload",
]);

const OBSERVATION_COMMANDS = new Set(["snapshot", "get", "find"]);

const IGNORED_COMMANDS = new Set([
  "close",
  "wait",
  "screenshot",
  "eval",
  "state",
  "addinitscript",
  "connect",
  "install",
  "highlight",
  "inspect",
  "trace",
  "cdp",
  "record",
  "profile",
  "cookies",
  "storage",
  "network",
  "download",
  "skills",
  "chat",
  "pdf",
  "batch",
]);

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function extractAgentBrowserSegment(line: string): string | null {
  const match = /agent-browser\b(.*)/.exec(line);
  if (!match?.[1]) return null;
  return match[1].trim();
}

function tokenizeRest(rest: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]!;
    if (quote) {
      current += ch;
      if (ch === quote && rest[i - 1] !== "\\") {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function categoryForSubcommand(sub: string): ActionOverlayCategory | null {
  if (MUTATION_COMMANDS.has(sub)) return "mutation";
  if (NAVIGATION_COMMANDS.has(sub)) return "navigation";
  if (OBSERVATION_COMMANDS.has(sub)) return "observation";
  if (IGNORED_COMMANDS.has(sub)) return null;
  return null;
}

function capitalize(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function buildLabel(subcommand: string, args: string[]): string {
  if (subcommand === "fill") {
    const target = args[0];
    return target ? `Fill ${target}` : "Fill";
  }
  if (subcommand === "get" && args.length > 0) {
    return `Get ${args.join(" ")}`;
  }
  if (subcommand === "find" && args.length > 0) {
    return `Find ${args.join(" ")}`;
  }
  if (subcommand === "open" || subcommand === "goto" || subcommand === "navigate") {
    const url = args[0] ? stripQuotes(args[0]) : "";
    return url ? `${capitalize(subcommand)} ${url}` : capitalize(subcommand);
  }
  if (args.length === 0) {
    return capitalize(subcommand);
  }
  return `${capitalize(subcommand)} ${args.join(" ")}`;
}

function extractTarget(
  subcommand: string,
  args: string[],
): string | undefined {
  if (subcommand === "fill") {
    return args[0];
  }
  if (subcommand === "get") {
    if (args[0] === "box" && args[1]) return args[1];
    if (args[0] && args[0] !== "url" && args[0] !== "title") {
      return args.slice(1).join(" ") || args[0];
    }
    return undefined;
  }
  if (subcommand === "find") {
    return undefined;
  }
  if (
    subcommand === "open" ||
    subcommand === "goto" ||
    subcommand === "navigate" ||
    subcommand === "back" ||
    subcommand === "forward" ||
    subcommand === "reload" ||
    subcommand === "snapshot"
  ) {
    return undefined;
  }
  return args[0];
}

function parseAgentBrowserRest(rest: string): ParsedAgentBrowserAction | null {
  const tokens = tokenizeRest(rest);
  if (tokens.length === 0) return null;

  let idx = 0;
  if (tokens[0] === "--headed") idx++;

  const subcommand = tokens[idx]?.toLowerCase();
  if (!subcommand) return null;

  const category = categoryForSubcommand(subcommand);
  if (!category) return null;

  const args = tokens.slice(idx + 1);
  return {
    category,
    subcommand,
    label: buildLabel(subcommand, args),
    target: extractTarget(subcommand, args),
  };
}

/**
 * Parse the first agent-browser UI/observation command from a bash line.
 * Returns null when no preview-worthy action is found.
 */
export function parseAgentBrowserAction(
  command: string,
): ParsedAgentBrowserAction | null {
  const segments = command.split(/\s*&&\s*|\s*;\s*/);
  for (const segment of segments) {
    const rest = extractAgentBrowserSegment(segment);
    if (!rest) continue;
    const parsed = parseAgentBrowserRest(rest);
    if (parsed) return parsed;
  }
  return null;
}
