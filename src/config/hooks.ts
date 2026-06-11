import path from "node:path";
import { pathToFileURL } from "node:url";
import { ensureProfileHook } from "../hooks/ensure-profile.js";
import type { PqaConfig } from "../types/config.js";
import type { ExtensionHooks } from "../types/hooks.js";

/**
 * Resolve an array of hook entries where each entry is either
 * a function reference or a string path to a module (`.ts`, `.js`, `.mjs`).
 *
 * String paths are resolved relative to `cwd`. If resolution fails,
 * a warning is logged and the entry is skipped.
 */
export async function resolveHookModules<T>(
  hooks: Array<T | string> | undefined,
  cwd: string,
): Promise<T[]> {
  if (!hooks || hooks.length === 0) return [];

  const results: T[] = [];

  for (let i = 0; i < hooks.length; i++) {
    const entry = hooks[i]!;

    if (typeof entry === "function") {
      results.push(entry);
      continue;
    }

    if (typeof entry !== "string") {
      console.warn(`[hooks] Skipping hook at index ${i}: expected function or string path, got ${typeof entry}`);
      continue;
    }

    try {
      const resolved = path.resolve(cwd, entry);
      const mod = await import(pathToFileURL(resolved).href);
      const exported = mod.default ?? mod;
      if (typeof exported !== "function") {
        console.warn(
          `[hooks] Module at "${entry}" does not export a default function or a named function compatible with the hook slot. Skipping.`,
        );
        continue;
      }
      results.push(exported as T);
    } catch (err) {
      console.warn(
        `[hooks] Failed to resolve hook module at "${entry}": ${err instanceof Error ? err.message : String(err)}. Skipping.`,
      );
    }
  }

  return results;
}

/**
 * Resolve all hook slots in an ExtensionHooks object.
 * Returns a new object with all string paths resolved to functions.
 */
export async function resolveAllHookModules(
  hooks: ExtensionHooks,
  cwd: string,
): Promise<ExtensionHooks> {
  const [preScenario, preSystemPrompt, preLlmTurn, postLlmTurn, preTool, postTool, preVerdict, postScenario] =
    await Promise.all([
      resolveHookModules(hooks.preScenario, cwd),
      resolveHookModules(hooks.preSystemPrompt, cwd),
      resolveHookModules(hooks.preLlmTurn, cwd),
      resolveHookModules(hooks.postLlmTurn, cwd),
      resolveHookModules(hooks.preTool, cwd),
      resolveHookModules(hooks.postTool, cwd),
      resolveHookModules(hooks.preVerdict, cwd),
      resolveHookModules(hooks.postScenario, cwd),
    ]);

  return {
    ...(preScenario.length > 0 ? { preScenario } : {}),
    ...(preSystemPrompt.length > 0 ? { preSystemPrompt } : {}),
    ...(preLlmTurn.length > 0 ? { preLlmTurn } : {}),
    ...(postLlmTurn.length > 0 ? { postLlmTurn } : {}),
    ...(preTool.length > 0 ? { preTool } : {}),
    ...(postTool.length > 0 ? { postTool } : {}),
    ...(preVerdict.length > 0 ? { preVerdict } : {}),
    ...(postScenario.length > 0 ? { postScenario } : {}),
  };
}

function hasAuthConfig(config: PqaConfig): boolean {
  return Object.keys(config.auth ?? {}).length > 0;
}

/**
 * Resolve user hook modules and prepend the built-in ensureProfile hook when
 * auth profiles are configured.
 */
export async function resolveConfigExtensionHooks(
  config: PqaConfig,
  cwd: string,
): Promise<ExtensionHooks | undefined> {
  const userHooks = config.extensions?.hooks;
  const resolvedUser = userHooks
    ? await resolveAllHookModules(userHooks, cwd)
    : {};

  const preScenario = [
    ...(hasAuthConfig(config) ? [ensureProfileHook] : []),
    ...(resolvedUser.preScenario ?? []),
  ];

  const merged: ExtensionHooks = {
    ...resolvedUser,
    ...(preScenario.length > 0 ? { preScenario } : {}),
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
}
