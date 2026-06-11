Proposition de mécanisme d'extension / hooks pour Prose QA

1. Points de hook identifiés dans le cycle de vie
   En analysant runner.ts, prompt.ts, bash.ts, verdict.ts et la config pqa.config.ts, voici les points de vie où des hooks seraient utiles :

┌─────────────────────────────────────────────────┐ │ pre-scenario (avant runScenario) │ │ • reçoit : scenario, config, context │ │ • peut : modifier config, skip, logger │ ├─────────────────────────────────────────────────┤ │ pre-system-prompt (avant buildSystemPrompt) │ │ • reçoit : config, skills, scenario, runtime │ │ • peut : ajouter des instructions au prompt │ ├─────────────────────────────────────────────────┤ │ pre-llm-turn (avant generateText) │ │ • reçoit : transcript, messages, turn count │ │ • peut : injecter des messages, logger │ ├─────────────────────────────────────────────────┤ │ post-llm-turn (après generateText step) │ │ • reçoit : text, toolCalls, transcript │ │ • peut : logger, modifier transcript │ ├─────────────────────────────────────────────────┤ │ pre-tool (avant bash.execute) │ │ • reçoit : command, env, context │ │ • peut : modifier/rewrite command, abort │ ├─────────────────────────────────────────────────┤ │ post-tool (après bash.execute) [DÉJÀ EXISTE] │ │ • reçoit : BashEntry │ │ • peut : abort, logger, enrichir │ ├─────────────────────────────────────────────────┤ │ pre-verdict (avant extractVerdict) │ │ • reçoit : finalText, transcript │ │ • peut : patcher le texte, logger │ ├─────────────────────────────────────────────────┤ │ post-scenario (après runScenario) │ │ • reçoit : ScenarioResult │ │ • peut : logger, exporter, notifier │ └─────────────────────────────────────────────────┘ 2. Langage : TypeScript / JavaScript (ESM)
PQA est déjà un projet TypeScript/Node ESM (package.json "type": "module"). La config se charge dynamiquement avec jiti — qui supporte nativement .ts, .mjs, .js, .json.

Recommandation : TypeScript (.ts) pour les extensions, pour deux raisons :

Typage fort : les signatures des hooks seront typées — l'utilisateur bénéficie de l'autocomplétion et de la vérification statique.
Déjà un pattern existant : la config (pqa.config.ts) est déjà en TypeScript, chargée via jiti. Les extensions utiliseraient le même mécanisme.
Extension possible plus tard : support de hooks en Rust/WASM via wasmtime ou napi-rs, ou en Python via Pyodide/subprocess — mais TypeScript d'abord est le chemin naturel.

3. Déclaration & Installation via pqa.config.ts
   Aucun package manager supplémentaire, pas de CLI pqa ext install. On réutilise le mécanisme de config existant. L'utilisateur déclare :

// pqa.config.ts
import { defineConfig } from "prose-qa";
import { SentryNotifier } from "./extensions/sentry-notifier.ts";
import { AuditLogger } from "./extensions/audit-logger.ts";

export default defineConfig({
// ... config existante ...

extensions: {
dirs: [".pqa/extensions"], // optionnel, pour autodiscovery
hooks: {
// Hooks inline ou importés
"pre-scenario": [
AuditLogger.beforeScenario,
MyExtension.beforeScenario,
],
"post-tool": [
(entry, ctx) => {
if (entry.exitCode !== 0) {
ctx.logger.warn(`Tool failed: ${entry.command}`);
}
return { action: "continue" };
},
],
"post-scenario": [SentryNotifier.afterScenario],
},
},
});
Variante plus simple (si on ne veut pas defineConfig) :

// pqa.config.ts
export default {
scenariosDir: "scenarios",
// ...
extensions: {
hooks: {
"post-scenario": "./extensions/sentry.mjs",
},
},
};
Dans tous les cas, l'utilisateur crée un fichier .ts ou .mjs dans son projet, et le référence dans pqa.config.ts. Zero installation — c'est juste du Node.

4. Signatures détaillées des hooks
   // ============================================================
   // Types partagés
   // ============================================================

export interface HookContext {
/** Harness logger (console.log wrapper, structuré si verbose) \*/
logger: Logger;
/** Le répertoire d'exécution du projet (cwd) _/
cwd: string;
/\*\* Config PQA fusionnée _/
config: PqaConfig;
/** Transcript en cours de construction \*/
transcript: AgentTranscript;
/** Métadonnées partagées entre hooks (extensible) _/
metadata: Record<string, unknown>;
/\*\* Fonction pour interrompre le scénario avec un message _/
abort: (reason: string) => never;
}

// ============================================================
// Hook: pre-scenario
// ============================================================
export type PreScenarioHook = (
scenario: Scenario,
ctx: HookContext,
) => PreScenarioResult | Promise<PreScenarioResult>;

export type PreScenarioResult =
| { action: "continue" }
| { action: "skip"; reason: string }
| { action: "abort"; error: string };

// ============================================================
// Hook: pre-system-prompt
// ============================================================
export type PreSystemPromptHook = (
params: {
config: PqaConfig;
skills: Skill[];
scenario: Scenario;
runtime: {
cwd: string;
artifactDir: string;
headed: boolean;
sessionName: string;
};
},
ctx: HookContext,
) => PreSystemPromptResult | Promise<PreSystemPromptResult>;

export interface PreSystemPromptResult {
/\*_ Instructions supplémentaires à ajouter au system prompt _/
extraInstructions?: string;
}

// ============================================================
// Hook: pre-llm-turn
// ============================================================
export type PreLlmTurnHook = (
params: {
messages: ModelMessage[];
turn: number;
maxTurns: number;
},
ctx: HookContext,
) => PreLlmTurnResult | Promise<PreLlmTurnResult>;

export interface PreLlmTurnResult {
/\*_ Messages additionnels à injecter avant l'appel LLM _/
extraMessages?: ModelMessage[];
}

// ============================================================
// Hook: post-llm-turn
// ============================================================
export type PostLlmTurnHook = (
params: {
text: string;
reasoningText?: string;
toolCalls: Array<{ toolName: string; input: unknown }>;
turn: number;
durationMs: number;
},
ctx: HookContext,
) => PostLlmTurnResult | Promise<PostLlmTurnResult>;

export interface PostLlmTurnResult {
/\*_ Texte modifié (par ex. pour redaction custom) _/
text?: string;
}

// ============================================================
// Hook: pre-tool
// ============================================================
export type PreToolHook = (
params: {
command: string;
timeoutMs: number;
env: Record<string, string | undefined>;
},
ctx: HookContext,
) => PreToolResult | Promise<PreToolResult>;

export interface PreToolResult {
/** Commande modifiée (rewrite) \*/
command?: string;
/** Timeout modifié _/
timeoutMs?: number;
/\*\* Variables d'env additionnelles _/
extraEnv?: Record<string, string>;
/\*_ Abort avant execution _/
action?: "continue" | "abort";
abortError?: string;
}

// ============================================================
// Hook: post-tool (pattern EXISTANT dans runner.ts)
// ============================================================
export type PostToolHook = (
entry: BashEntry,
ctx: HookContext,
) => PostToolResult | Promise<PostToolResult>;

export type PostToolResult =
| { action: "continue" }
| { action: "abort"; error: string };

// ============================================================
// Hook: pre-verdict
// ============================================================
export type PreVerdictHook = (
params: {
finalText: string;
transcript: AgentTranscript;
},
ctx: HookContext,
) => PreVerdictResult | Promise<PreVerdictResult>;

export interface PreVerdictResult {
/\*_ Texte patched avant parsing du verdict JSON _/
finalText?: string;
}

// ============================================================
// Hook: post-scenario
// ============================================================
export type PostScenarioHook = (
result: ScenarioResult,
ctx: HookContext,
) => PostScenarioResult | Promise<PostScenarioResult>;

export interface PostScenarioResult {
/\*_ Permet de modifier le résultat final _/
result?: Partial<ScenarioResult>;
} 5. Où brancher chaque hook dans le code
En reprenant l'architecture de runner.ts, l'implantation se fait ainsi :

runScenario(options) │ ├─ Appel de tous les pre-scenario hooks │ (si un hook retourne { action: "skip" } → on skip) │ (si { action: "abort" } → erreur) │ ├─ buildSystemPrompt(...) │ └─ Appel des pre-system-prompt hooks → extraInstructions │ ├─ for each LLM turn (onStepFinish) : │ ├─ Appel des pre-llm-turn hooks → extraMessages │ ├─ generateText(...) │ └─ Appel des post-llm-turn hooks │ ├─ bash tool execute() : │ ├─ Appel des pre-tool hooks → command modifiée │ ├─ runBash(...) │ └─ Appel des post-tool hooks (bashHooks déjà existants) │ ├─ retryVerdictCompletion(...) │ └─ Appel des pre-verdict hooks → finalText patché │ └─ Appel des post-scenario hooks → result modifié
Le code existant bashHooks dans RunScenarioOptions est déjà un pattern validé. Il suffit d'étendre RunScenarioOptions avec :

interface RunScenarioOptions {
// ... existant ...
bashHooks?: BashToolHook[];
// ↓ nouveau
extensionHooks?: {
preScenario?: PreScenarioHook[];
preSystemPrompt?: PreSystemPromptHook[];
preLlmTurn?: PreLlmTurnHook[];
postLlmTurn?: PostLlmTurnHook[];
preTool?: PreToolHook[];
postScenario?: PostScenarioHook[];
};
} 6. Avantages de cette approche
Critère Solution
Zero install L'utilisateur écrit un .ts local, référencé dans pqa.config.ts. Rien à npm install.
Typage fort Toutes les signatures TypeScript avec zod-like validation des retours.
Performant Pas de subprocess, pas de protocole — appels synchrones/async en mémoire.
Compatible existant Le post-tool hook existe déjà sous bashHooks. On scale le pattern à tout le lifecycle.
Extensible Un champ metadata: Record<string, unknown> dans HookContext permet aux hooks de se passer des données.
Sécurisé Le hook peut abort() proprement, l'exception est catchée par runScenario. 7. (Optionnel) Aller plus loin — API déclarative defineExtension
Pour une DX optimale, on peut exposer une fonction utilitaire :

// .pqa/extensions/sentry.ts
import { defineExtension } from "prose-qa";

export default defineExtension({
name: "sentry",
hooks: {
"post-scenario": async (result, ctx) => {
if (result.status === "fail" || result.status === "error") {
await sendToSentry({
scenario: result.scenario,
error: result.error,
durationMs: result.durationMs,
});
}
},
},
});
Et dans la config :

extensions: {
// chargement automatique des .ts/.mjs dans .pqa/extensions/
dirs: [".pqa/extensions"],
// ou explicite
hooks: {
"post-scenario": [".pqa/extensions/sentry.ts"],
},
}
En résumé : le mécanisme de hook propose ~8 points de vie, en TypeScript (via jiti, comme la config), déclaré dans pqa.config.ts, avec des signatures fortement typées qui reçoivent les structures PQA existantes (Scenario, BashEntry, AgentTranscript, ScenarioResult, etc.) et retournent des résultats simples ("continue" | "abort", ou des transformations ciblées). L'infrastructure de hook post-bash existe déjà — c'est une généralisation de ce pattern à l'ensemble du lifecycle.
