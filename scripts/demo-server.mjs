import http from "node:http";
import { randomBytes } from "node:crypto";

const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 8080);

/** Demo credentials — must match PQA_TEST_EMAIL / PQA_TEST_PASSWORD in .env.example */
const DEMO_EMAIL = "demo@pqa.local";
const DEMO_PASSWORD = "demo-password";

const sessions = new Map();

function htmlPage(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
</head>
<body>
${body}
</body>
</html>`;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey) continue;
    out[rawKey] = decodeURIComponent(rest.join("="));
  }
  return out;
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const id = cookies.pqa_session;
  if (!id) return null;
  return sessions.get(id) ?? null;
}

function setSessionCookie(res, sessionId) {
  res.setHeader(
    "Set-Cookie",
    `pqa_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax`,
  );
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function parseFormBody(body) {
  const params = new URLSearchParams(body);
  return {
    email: params.get("email") ?? "",
    password: params.get("password") ?? "",
  };
}

function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location });
  res.end();
}

function sendHtml(res, status, title, body) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(htmlPage(title, body));
}

const routes = {
  GET: {
    "/": () =>
      htmlPage(
        "Hello",
        [
          "<h1>Hello World</h1>",
          '<div style="display: flex; flex-direction: row; gap: 10px; align-items: center;">',
          '<p>A: <input id="input-a" type="number" aria-label="A" /></p>',
          "<p>+</p>",
          '<p style="display: flex; flex-direction: row;">',
          "<p>B:</p>",
          '<div style="display: flex; flex-direction: column; gap: 2px;">',
          '<p style="margin: 0"><label>4 <input type="radio" name="b" aria-label="B" value="4" /></label></p>',
          '<p style="margin: 0"><label>5 <input type="radio" name="b" aria-label="B" value="5" /></label></p>',
          '<p style="margin: 0"><label>6 <input type="radio" name="b" aria-label="B" value="6" /></label></p>',
          "</div>",
          "</p>",
          "<p>=</p>",
          '<p id="result">—</p>',
          "</div>",
          "<script>",
          "(function () {",
          '  const inputA = document.getElementById("input-a");',
          "  const radiosB = document.querySelectorAll('input[aria-label=\"B\"]');",
          '  const resultEl = document.getElementById("result");',
          "  function updateResult() {",
          "    const a = Number(inputA.value) || 0;",
          "    const selectedB = Array.from(radiosB).find((r) => r.checked);",
          "    const b = selectedB ? Number(selectedB.value) : 0;",
          "    resultEl.textContent = a + b;",
          "  }",
          '  inputA.addEventListener("input", updateResult);',
          '  radiosB.forEach((r) => r.addEventListener("change", updateResult));',
          "})();",
          "</script>",
          '<p><a href="/login">Sign in</a></p>',
        ].join(""),
      ),
    "/login": (req) => {
      if (getSession(req)) {
        return { redirect: "/projects" };
      }
      const error = new URL(req.url ?? "", "http://x").searchParams.get(
        "error",
      );
      const errBlock =
        error === "1"
          ? '<p role="alert">Invalid email or password. Try again.</p>'
          : "";
      return htmlPage(
        "Sign in",
        `<h1>Sign in</h1>
${errBlock}
<form method="post" action="/login">
  <p>
    <label for="email">Email</label><br>
    <input id="email" name="email" type="email" autocomplete="username" required>
  </p>
  <p>
    <label for="password">Password</label><br>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
  </p>
  <p><button type="submit">Sign in</button></p>
</form>`,
      );
    },
    "/projects": (req) => {
      const session = getSession(req);
      if (!session) {
        return { redirect: "/login" };
      }
      return htmlPage(
        "Projects",
        `<h1>Projects</h1>
<p>Welcome, ${session.email}</p>
<p>You are viewing a protected page.</p>`,
      );
    },
  },
};

async function handlePostLogin(req, res) {
  const body = await readBody(req);
  const { email, password } = parseFormBody(body);
  if (email === DEMO_EMAIL && password === DEMO_PASSWORD) {
    const sessionId = randomBytes(16).toString("hex");
    sessions.set(sessionId, { email: DEMO_EMAIL });
    setSessionCookie(res, sessionId);
    redirect(res, "/projects");
    return;
  }
  redirect(res, "/login?error=1");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    const pathname = url.pathname;

    if (req.method === "POST" && pathname === "/login") {
      await handlePostLogin(req, res);
      return;
    }

    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method Not Allowed");
      return;
    }

    const handler = routes.GET[pathname];
    if (!handler) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    const result = handler(req);
    if (result && typeof result === "object" && "redirect" in result) {
      redirect(res, result.redirect);
      return;
    }

    const title =
      pathname === "/login"
        ? "Sign in"
        : pathname === "/projects"
          ? "Projects"
          : "Hello";
    sendHtml(res, 200, title, result);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(err instanceof Error ? err.message : "Internal Server Error");
  }
});

server.listen(port, host, () => {
  process.stdout.write(
    `smoke server http://${host}:${port} (login ${DEMO_EMAIL} / ${DEMO_PASSWORD})\n`,
  );
});
