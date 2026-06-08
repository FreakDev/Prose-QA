export function formatDeclaredEnvVarHints(varNames: string[]): string[] {
  if (varNames.length === 0) return [];

  return [
    "",
    "Declared environment variables available in bash:",
    ...varNames.map((name) => {
      const isSet = Boolean(process.env[name]);
      const status = isSet ? "set" : "not set";
      return `- ${name} — ${status}; reference as $${name} in bash (e.g. agent-browser type "$${name}")`;
    }),
  ];
}
