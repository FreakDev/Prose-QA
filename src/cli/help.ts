export interface CliArgument {
  name: string;
  description: string;
  defaultValue?: string;
}

export interface CliOption {
  flags: string;
  description: string;
  defaultValue?: string;
}

export interface CliCommandHelp {
  name: string;
  summary: string;
  usage: string;
  description: string;
  arguments?: CliArgument[];
  options?: CliOption[];
  subcommands?: CliCommandHelp[];
}

export const CLI_REFERENCE: CliCommandHelp[] = [
  {
    name: "run",
    summary: "Run E2E scenarios (CI mode)",
    usage: "pqa run [patterns...] [options]",
    description:
      "Execute scenario files against your app. Headless by default; suited for CI.",
    arguments: [
      {
        name: "patterns",
        description: "Glob patterns for scenario markdown files",
        defaultValue: "<scenariosDir>/**/*.md from pqa.config when omitted",
      },
    ],
    options: [
      {
        flags: "-c, --config <path>",
        description: "Path to pqa.config.json (or .mjs / .ts / .js)",
      },
      {
        flags: "--tags <tags>",
        description:
          "Comma-separated tags matched with AND; repeat for OR; prefix ! to exclude",
      },
      {
        flags: "--tag <tag>",
        description: "Single tag matched with OR; repeat for OR; prefix ! to match absence",
      },
      {
        flags: "--skills-dir <dirs>",
        description: "Extra skill directories, comma-separated",
      },
      {
        flags: "--retries <n>",
        description: "Retry count per failed scenario",
        defaultValue: "0",
      },
      {
        flags: "--retries-policy <policy>",
        description:
          "When healing is enabled: retry only transient failures (transient) or any failure (always)",
        defaultValue: "transient",
      },
      {
        flags: "--no-healing",
        description:
          "Disable in-run recovery and transient-only retry gating (retries apply to all failures)",
      },
      {
        flags: "--no-cache",
        description: "Do not load or write scenario replay hints cache",
      },
      {
        flags: "--artifacts <mode>",
        description: "When to keep artifacts: on-failure, always, or never",
        defaultValue: "on-failure",
      },
      { flags: "--headed", description: "Run the browser in headed (visible) mode" },
      {
        flags: "--keep-browser",
        description: "Leave the browser open after each scenario for inspection",
      },
      {
        flags: "--auth-refresh",
        description: "Re-run auth scenarios and refresh the auth store",
      },
      {
        flags: "--parallel [n]",
        description:
          "Run scenarios in parallel subprocesses; optional max concurrency (omit n for unlimited). Keeps up to n scenarios running and starts the next as soon as a slot frees.",
      },
      {
        flags: "--fail-fast",
        description: "Stop on first failure instead of running all scenarios",
      },
    ],
  },
  {
    name: "debug",
    summary: "Run scenarios with verbose output (local debug)",
    usage: "pqa debug [patterns...] [options]",
    description:
      "Same as run, but verbose logging and headed browser by default. Use for local troubleshooting.",
    arguments: [
      {
        name: "patterns",
        description: "Glob patterns for scenario markdown files",
        defaultValue: "<scenariosDir>/**/*.md from pqa.config when omitted",
      },
    ],
    options: [
      {
        flags: "-c, --config <path>",
        description: "Path to pqa.config.json (or .mjs / .ts / .js)",
      },
      {
        flags: "--tags <tags>",
        description:
          "Comma-separated tags matched with AND; repeat for OR; prefix ! to exclude",
      },
      {
        flags: "--tag <tag>",
        description: "Single tag matched with OR; repeat for OR; prefix ! to match absence",
      },
      {
        flags: "--skills-dir <dirs>",
        description: "Extra skill directories, comma-separated",
      },
      {
        flags: "--pause",
        description: "Pause between agent turns (press Enter to continue)",
      },
      {
        flags: "--keep-browser",
        description: "Leave the browser open after each scenario for inspection",
      },
      {
        flags: "--auth-refresh",
        description: "Re-run auth scenarios and refresh the auth store",
      },
      {
        flags: "--retries <n>",
        description: "Retry count per failed scenario",
        defaultValue: "0",
      },
      {
        flags: "--retries-policy <policy>",
        description:
          "When healing is enabled: retry only transient failures (transient) or any failure (always)",
        defaultValue: "transient",
      },
      { flags: "--no-healing", description: "Disable in-run recovery and transient-only retries" },
      {
        flags: "--no-cache",
        description: "Do not load or write scenario replay hints cache",
      },
      {
        flags: "--parallel [n]",
        description:
          "Run scenarios in parallel subprocesses; optional max concurrency (omit n for unlimited). Keeps up to n scenarios running and starts the next as soon as a slot frees.",
      },
      {
        flags: "--fail-fast",
        description: "Stop on first failure instead of running all scenarios",
      },
      {
        flags: "--no-headed",
        description: "Run the browser headless instead of the debug default (headed)",
      },
    ],
  },
  {
    name: "clear-cache",
    summary: "Clear scenario replay hints cache",
    usage: "pqa clear-cache [scenario] [options]",
    description:
      "Remove cached replay hints for one scenario (by frontmatter name) or all scenarios.",
    arguments: [
      {
        name: "scenario",
        description: "Scenario name to clear; omit to clear all caches",
      },
    ],
    options: [
      {
        flags: "-c, --config <path>",
        description: "Path to pqa.config.json (or .mjs / .ts / .js)",
      },
    ],
  },
  {
    name: "config",
    summary: "Set a value in pqa.config.json",
    usage: "pqa config <key> <value>",
    description:
      "Write a configuration override to pqa.config.json in the current directory. Creates an empty file when missing. Use dot notation for nested keys (e.g. browser.headed true). Keys must exist in the bundled reference config.",
    arguments: [
      {
        name: "key",
        description: "Config key, dot-separated for nested properties (e.g. browser.headed)",
      },
      {
        name: "value",
        description: "Value to set (booleans, numbers, JSON arrays/objects, or strings)",
      },
    ],
  },
  {
    name: "analyze",
    summary: "Analyze run(s) and review scenario fixes interactively",
    usage: "pqa analyze [runPathOrId...] [options]",
    description:
      "Single run: heuristic classification and LLM analysis on failed scenarios, then interactive patch review ([y/n/e/s/q/?]). Multiple runs or --last N: detect flaky scenarios with inconsistent verdicts, compare pass vs fail transcripts, and propose stabilizing edits.",
    arguments: [
      {
        name: "runPathOrId...",
        description:
          "One or more run directories or ids under .pqa/runs/ (default: latest run; 2+ ids or --last N enables multi-run flaky analysis)",
      },
    ],
    options: [
      { flags: "--config <path>", description: "Path to pqa.config file" },
      {
        flags: "--last <n>",
        description:
          "Compare the N most recent runs for flaky scenarios (requires n ≥ 2)",
      },
    ],
  },
  {
    name: "record",
    summary: "Record browser sessions and generate scenarios",
    usage: "pqa record <subcommand>",
    description:
      "Capture user actions in a headed browser (or Chrome via --connect), then generate scenario markdown with the configured LLM.",
    subcommands: [
      {
        name: "start",
        summary: "Start recording",
        usage: "pqa record start [options]",
        description: "Open a headed browser with the recorder script and local event bridge.",
        options: [
          { flags: "-c, --config <path>", description: "Config file path" },
          { flags: "--url <url>", description: "URL to open when recording starts" },
          { flags: "--no-headed", description: "Run headless (not recommended)" },
          { flags: "--session <name>", description: "agent-browser session name" },
          {
            flags: "--connect <port>",
            description: "Connect to Chrome CDP port instead of launching",
          },
        ],
      },
      {
        name: "note",
        summary: "Add a comment to the active recording",
        usage: "pqa record note <text>",
        description: "Append a free-form note for scenario generation.",
        arguments: [{ name: "text", description: "Comment text" }],
      },
      {
        name: "checkpoint",
        summary: "Add a Then-section hint",
        usage: "pqa record checkpoint <text>",
        description: "Append a checkpoint hint for the generated Then section.",
        arguments: [{ name: "text", description: "Checkpoint hint" }],
      },
      {
        name: "stop",
        summary: "Stop recording and generate scenario",
        usage: "pqa record stop [options]",
        description: "Close the browser and generate scenarios/recorded/<name>.md.",
        options: [
          { flags: "--name <name>", description: "Scenario name (kebab-case)" },
          { flags: "--out <path>", description: "Output markdown path" },
          { flags: "--no-generate", description: "Save events only, skip LLM" },
        ],
      },
      {
        name: "generate",
        summary: "Generate scenario from a saved recording",
        usage: "pqa record generate <recordingDir>",
        description: "Regenerate scenario markdown from .pqa/recordings/<id>/.",
        arguments: [
          {
            name: "recordingDir",
            description: "Path to a recording directory",
          },
        ],
        options: [
          { flags: "--name <name>", description: "Scenario name" },
          { flags: "--out <path>", description: "Output markdown path" },
        ],
      },
    ],
  },
  {
    name: "skills",
    summary: "Manage agent skills",
    usage: "pqa skills <subcommand>",
    description: "Inspect and sync Anthropic-compatible SKILL.md files.",
    subcommands: [
      {
        name: "list",
        summary: "List discovered skills",
        usage: "pqa skills list [options]",
        description: "Print skill names, descriptions, and source directories.",
        options: [
          {
            flags: "--skills-dir <dirs>",
            description: "Skill directories to scan (comma-separated)",
            defaultValue: "skills, .agents/skills",
          },
        ],
      },
      {
        name: "show",
        summary: "Show full skill content",
        usage: "pqa skills show <name> [options]",
        description: "Print the full body of a skill by name.",
        arguments: [{ name: "name", description: "Skill name to display" }],
        options: [
          {
            flags: "--skills-dir <dirs>",
            description: "Skill directories to scan (comma-separated)",
            defaultValue: "skills, .agents/skills",
          },
        ],
      },
      {
        name: "sync",
        summary: "Sync agent-browser skill from pinned npm version",
        usage: "pqa skills sync",
        description:
          "Re-vendor the agent-browser skill into skills/agent-browser/ (dev repo workflow).",
      },
    ],
  },
  {
    name: "auth",
    summary: "Authentication helpers",
    usage: "pqa auth <subcommand>",
    description: "Manage cached browser auth state for scenario profiles.",
    subcommands: [
      {
        name: "list",
        summary: "List cached auth profiles",
        usage: "pqa auth list",
        description: "Show profiles stored in the auth store with paths and timestamps.",
      },
      {
        name: "clear",
        summary: "Clear cached auth state",
        usage: "pqa auth clear [profile]",
        description: "Remove one profile or all profiles from the auth store.",
        arguments: [
          {
            name: "profile",
            description: "Profile name to clear; omit to clear all",
          },
        ],
      },
      {
        name: "save",
        summary: "Run auth scenario and save state",
        usage: "pqa auth save <name> [options]",
        description:
          "Execute the configured auth scenario for a profile and persist browser state.",
        arguments: [{ name: "name", description: "Auth profile name from config" }],
        options: [
          {
            flags: "-c, --config <path>",
            description: "Path to pqa.config.json (or .mjs / .ts / .js)",
          },
          { flags: "-v, --verbose", description: "Enable verbose agent output" },
        ],
      },
    ],
  },
  {
    name: "mcp",
    summary: "Start MCP server (stdio)",
    usage: "pqa mcp",
    description:
      "Expose the create-pqa-scenario skill and tools to validate or run inline scenario markdown for Cursor and other MCP clients. Uses stdio transport; configure the client to spawn this command in your project directory (where pqa.config and env vars live).",
  },
  {
    name: "help",
    summary: "Show help for commands and options",
    usage: "pqa help [command]",
    description: "List all commands or show detailed help for one command.",
    arguments: [
      {
        name: "command",
        description: "Command name (e.g. run, debug, skills, auth)",
      },
    ],
  },
];

const GLOBAL_OPTIONS: CliOption[] = [
  { flags: "-V, --version", description: "Print the CLI version" },
  { flags: "-h, --help", description: "Show help for a command" },
];

function findCommand(path: string[]): CliCommandHelp | undefined {
  if (path.length === 0) return undefined;

  const [head, ...rest] = path;
  const top = CLI_REFERENCE.find((c) => c.name === head);
  if (!top) return undefined;
  if (rest.length === 0) return top;

  const sub = top.subcommands?.find((c) => c.name === rest[0]);
  if (!sub) return undefined;
  if (rest.length === 1) return sub;
  return undefined;
}

function formatDefault(value: string): string {
  return ` (default: ${value})`;
}

function printSection(title: string, lines: string[]): void {
  if (lines.length === 0) return;
  console.log(`\n${title}:`);
  for (const line of lines) {
    console.log(`  ${line}`);
  }
}

function printCommandHelp(cmd: CliCommandHelp): void {
  console.log(`\n${cmd.usage}\n`);
  console.log(cmd.description);

  if (cmd.arguments?.length) {
    printSection(
      "Arguments",
      cmd.arguments.map((arg) => {
        const suffix = arg.defaultValue
          ? formatDefault(arg.defaultValue)
          : "";
        return `${arg.name.padEnd(14)} ${arg.description}${suffix}`;
      }),
    );
  }

  if (cmd.options?.length) {
    printSection(
      "Options",
      cmd.options.map((opt) => {
        const suffix = opt.defaultValue
          ? formatDefault(opt.defaultValue)
          : "";
        return `${opt.flags.padEnd(22)} ${opt.description}${suffix}`;
      }),
    );
  }

  if (cmd.subcommands?.length) {
    printSection(
      "Subcommands",
      cmd.subcommands.map(
        (sub) => `${sub.name.padEnd(14)} ${sub.summary}`,
      ),
    );
    console.log("\nRun `pqa help <command> <subcommand>` for subcommand options.");
  }
}

export function printTopLevelHelp(): void {
  console.log("ProseQA — agent harness for NL E2E regression testing\n");
  console.log("Usage: pqa <command> [options]\n");
  console.log("Commands:");
  for (const cmd of CLI_REFERENCE) {
    console.log(`  ${cmd.name.padEnd(14)} ${cmd.summary}`);
  }
  printSection(
    "Global options",
    GLOBAL_OPTIONS.map(
      (opt) => `${opt.flags.padEnd(22)} ${opt.description}`,
    ),
  );
  console.log("\nRun `pqa help <command>` for command-specific options.");
  console.log("Exit codes: 0 pass · 1 failure · 2 config/harness error");
}

export function executeHelp(args: string[]): number {
  const path = args.filter(Boolean);
  if (path.length === 0) {
    printTopLevelHelp();
    return 0;
  }

  const cmd = findCommand(path);
  if (!cmd) {
    console.error(`Unknown command: ${path.join(" ")}`);
    console.error("Run `pqa help` for a list of commands.");
    return 2;
  }

  printCommandHelp(cmd);
  return 0;
}
