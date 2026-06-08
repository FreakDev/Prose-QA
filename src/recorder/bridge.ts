import http from "node:http";
import type { RecordEvent } from "../types/recorder.js";

export interface RecordingBridge {
  port: number;
  url: string;
  append: (event: RecordEvent) => void;
  close: () => Promise<void>;
}

export function startRecordingBridge(options: {
  port: number;
  onEvent: (event: RecordEvent) => void;
}): Promise<RecordingBridge> {
  const append = (event: RecordEvent) => {
    options.onEvent({ ...event, ts: event.ts || Date.now() });
  };

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

      if (req.method === "POST" && req.url === "/event") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          try {
            const body = JSON.parse(
              Buffer.concat(chunks).toString("utf-8"),
            ) as RecordEvent;
            append(body);
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
    server.listen(options.port, "127.0.0.1", () => {
      const address = server.address();
      const boundPort =
        typeof address === "object" && address && "port" in address
          ? address.port
          : options.port;
      const url = `http://127.0.0.1:${boundPort}`;

      resolve({
        port: boundPort,
        url,
        append,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((err) => (err ? closeReject(err) : closeResolve()));
          }),
      });
    });
  });
}
