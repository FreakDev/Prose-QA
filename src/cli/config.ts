import { setConfigValue } from "../config/set.js";

export async function executeConfig(key: string, value: string): Promise<number> {
  try {
    await setConfigValue(key, value);
    console.log(`Set ${key} = ${value}`);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    return 2;
  }
}
