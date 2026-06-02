import { startPqaMcpServer } from "../mcp/server.js";

export async function executeMcpServe(): Promise<number> {
  try {
    await startPqaMcpServer(process.cwd());
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`MCP server error: ${message}`);
    return 1;
  }
}
