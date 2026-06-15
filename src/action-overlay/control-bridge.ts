import http from "node:http";

export type OverlayControlAction = "play" | "pause" | "stop";

export interface OverlayControlBridge {
  port: number;
  url: string;
  close: () => Promise<void>;
}

export function startOverlayControlBridge(options: {
  port?: number;
  onControl: (action: OverlayControlAction) => void;
}): Promise<OverlayControlBridge> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      };

      if (req.method === "OPTIONS") {
        res.writeHead(204, cors);
        res.end();
        return;
      }

      if (req.method === "POST" && req.url === "/control") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          try {
            const body = JSON.parse(
              Buffer.concat(chunks).toString("utf-8"),
            ) as { action?: string };
            const action = body.action;
            if (action !== "play" && action !== "pause" && action !== "stop") {
              res.writeHead(400, { ...cors, "Content-Type": "text/plain" });
              res.end("Invalid action");
              return;
            }
            options.onControl(action);
            res.writeHead(204, cors);
            res.end();
          } catch {
            res.writeHead(400, { ...cors, "Content-Type": "text/plain" });
            res.end("Invalid JSON");
          }
        });
        return;
      }

      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { ...cors, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      res.writeHead(404, cors);
      res.end();
    });

    server.on("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const address = server.address();
      const boundPort =
        typeof address === "object" && address && "port" in address
          ? address.port
          : (options.port ?? 0);
      resolve({
        port: boundPort,
        url: `http://127.0.0.1:${boundPort}`,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((err) => (err ? closeReject(err) : closeResolve()));
          }),
      });
    });
  });
}
