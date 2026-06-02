import http from "node:http";

const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 8080);

const html = "<!DOCTYPE html><html><body>Hello World</body></html>";

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
});

server.listen(port, host, () => {
  process.stdout.write(`smoke server http://${host}:${port}\n`);
});
