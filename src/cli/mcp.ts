import { startPqaMcpServer } from "../mcp/server.js";

/**
 * Runs until the MCP client closes stdin or the transport disconnects.
 * Do not call process.exit until this promise settles.
 */
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
