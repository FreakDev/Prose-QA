import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import {
  CREATE_PQA_SCENARIO_SKILL_URI,
  loadCreatePqaScenarioSkill,
} from "./skill.js";
import {
  validateInlineScenarioContent,
  writeInlineScenarioFile,
} from "./inline-scenario.js";
import { executeScenarioWorker } from "../cli/run.js";
import { createRunId, ensureRunDir } from "../reporter/index.js";
import type { RunOptions } from "../types/config.js";
import { formatScenarioForPrompt } from "../scenarios/parser.js";
import { PACKAGE_VERSION } from "../version.js";

const RUN_SCENARIO_INPUT = z.object({
  content: z
    .string()
    .min(1)
    .describe(
      "Full scenario markdown (YAML frontmatter with name, plus # Goal, # Steps, # Then sections)",
    ),
  config: z.string().optional().describe("Path to pqa.config file"),
  headed: z.boolean().optional().describe("Run browser in headed mode"),
  verbose: z.boolean().optional().describe("Verbose harness output"),
  retries: z.number().int().min(0).optional().describe("Retries on failure"),
  keepBrowser: z
    .boolean()
    .optional()
    .describe("Leave browser open after the scenario"),
});

const VALIDATE_SCENARIO_INPUT = z.object({
  content: z
    .string()
    .min(1)
    .describe("Scenario markdown to validate (same format as a .md file)"),
});

function workerOptions(
  args: z.infer<typeof RUN_SCENARIO_INPUT>,
): Omit<RunOptions, "parallel" | "pause" | "failFast"> {
  return {
    configPath: args.config,
    headed: args.headed,
    verbose: args.verbose ?? true,
    retries: args.retries ?? 0,
    keepBrowser: args.keepBrowser,
    artifacts: "on-failure",
  };
}

export function createPqaMcpServer(cwd: string): McpServer {
  const server = new McpServer(
    { name: "prose-qa", version: PACKAGE_VERSION },
    {
      instructions: [
        "Prose-QA MCP exposes scenario authoring and execution for browser E2E tests.",
        `Read ${CREATE_PQA_SCENARIO_SKILL_URI} before writing scenario markdown.`,
        "Use run_scenario with full file content (frontmatter + Goal/Steps/Then).",
        "Use validate_scenario to check markdown without running the browser.",
      ].join(" "),
    },
  );

  server.registerResource(
    "create-pqa-scenario-skill",
    CREATE_PQA_SCENARIO_SKILL_URI,
    {
      title: "Create PQA scenario skill",
      description:
        "Agent skill for authoring Prose-QA scenario markdown (frontmatter, Goal, Steps, Then)",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [
        {
          uri: CREATE_PQA_SCENARIO_SKILL_URI,
          mimeType: "text/markdown",
          text: loadCreatePqaScenarioSkill(cwd),
        },
      ],
    }),
  );

  server.registerTool(
    "get_create_pqa_scenario_skill",
    {
      title: "Get create-pqa-scenario skill",
      description:
        "Returns the create-pqa-scenario Agent Skill (Prose-QA scenario authoring guide)",
      annotations: { readOnlyHint: true },
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text: loadCreatePqaScenarioSkill(cwd),
        },
      ],
    }),
  );

  server.registerTool(
    "validate_scenario",
    {
      title: "Validate scenario markdown",
      description:
        "Parse scenario markdown without running the browser; returns name, tags, and section summary or an error",
      inputSchema: VALIDATE_SCENARIO_INPUT,
      annotations: { readOnlyHint: true },
    },
    async ({ content }) => {
      const result = validateInlineScenarioContent(content, cwd);
      if (!result.ok) {
        return {
          content: [{ type: "text" as const, text: result.error }],
          isError: true,
        };
      }
      const { scenario } = result;
      const summary = {
        name: scenario.frontmatter.name,
        tags: scenario.frontmatter.tags ?? [],
        url: scenario.frontmatter.url,
        partial: scenario.frontmatter.partial ?? false,
        checkpointCount: scenario.checkpoints.length,
        preview: formatScenarioForPrompt(scenario),
      };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    },
  );

  server.registerTool(
    "run_scenario",
    {
      title: "Run Prose-QA scenario",
      description:
        "Execute a scenario from inline markdown (same format as scenarios/*.md). Requires LLM and browser env configured in the project.",
      inputSchema: RUN_SCENARIO_INPUT,
      annotations: {
        title: "Run scenario",
        destructiveHint: false,
      },
    },
    async (args) => {
      let filePath: string;
      try {
        ({ filePath } = writeInlineScenarioFile(args.content, cwd));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: "text" as const, text: `Invalid scenario: ${message}` },
          ],
          isError: true,
        };
      }

      const runDir = ensureRunDir(cwd, createRunId());
      const exitCode = await executeScenarioWorker(
        filePath,
        runDir,
        workerOptions(args),
      );

      const status =
        exitCode === 0 ? "pass" : exitCode === 2 ? "error" : "fail";
      const payload = {
        status,
        exitCode,
        runDir,
        scenarioFile: filePath,
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(payload, null, 2),
          },
        ],
        isError: exitCode !== 0,
      };
    },
  );

  server.registerPrompt(
    "author_pqa_scenario",
    {
      title: "Author a Prose-QA scenario",
      description:
        "Prompt template that includes the create-pqa-scenario skill for writing scenario markdown",
      argsSchema: {
        goal: z
          .string()
          .optional()
          .describe("Short description of what the scenario should cover"),
      },
    },
    async ({ goal }) => {
      const skill = loadCreatePqaScenarioSkill(cwd);
      const goalLine = goal ? `The user wants a scenario for: ${goal}\n\n` : "";
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `${goalLine}Use the Prose-QA scenario skill below to draft or edit scenario markdown (frontmatter, # Goal, # Steps, # Then).\n\n${skill}`,
            },
          },
        ],
      };
    },
  );

  return server;
}

export async function startPqaMcpServer(cwd: string): Promise<void> {
  const server = createPqaMcpServer(cwd);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(
    "Prose-QA MCP server listening on stdio (create-pqa-scenario skill, run_scenario, validate_scenario).",
  );

  await new Promise<void>((resolve) => {
    const previousOnClose = transport.onclose;
    transport.onclose = () => {
      previousOnClose?.();
      resolve();
    };
  });

  await server.close();
}
