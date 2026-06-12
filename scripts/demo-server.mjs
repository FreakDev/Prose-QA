import http from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const demoSiteRoot = path.join(__dirname, "..", "demo-site");

const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 8080);

/** Demo credentials — must match PQA_TEST_EMAIL / PQA_TEST_PASSWORD in .env.example */
const DEMO_EMAIL = "demo@pqa.local";
const DEMO_PASSWORD = "demo-password";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const sessions = new Map();

/** Human-check equation: left - A + B = target */
const CAPTCHA_EQUATION = {
  left: 10,
  target: 13,
};

function evalCaptchaEquation(a, b) {
  return CAPTCHA_EQUATION.left - a + b;
}

function isCaptchaEquationValid(aRaw, bRaw) {
  const a = Number(aRaw);
  const b = Number(bRaw);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return evalCaptchaEquation(a, b) === CAPTCHA_EQUATION.target;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function htmlPage(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
${body}
</body>
</html>`;
}

function siteNav(active) {
  const link = (href, label, key) =>
    key === active
      ? `<a href="${href}" aria-current="page">${label}</a>`
      : `<a href="${href}">${label}</a>`;
  return `<header class="site-header">
    <nav class="site-nav" aria-label="Main">
      <a class="site-brand" href="/">PQA Demo</a>
      ${link("/", "Home", "home")}
      ${link("/playground/form", "Form playground", "form")}
      ${link("/login", "Sign in", "login")}
    </nav>
  </header>`;
}

function readStatic(relativePath) {
  const filePath = path.join(demoSiteRoot, relativePath);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf-8");
}

function serveStatic(res, relativePath) {
  const filePath = path.join(demoSiteRoot, relativePath);
  if (!existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return false;
  }
  const ext = path.extname(relativePath);
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  res.end(readFileSync(filePath));
  return true;
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

function parseUrlEncodedBody(body) {
  return new URLSearchParams(body);
}

function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location });
  res.end();
}

function sendHtml(res, status, html) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function validatePlaygroundForm(params) {
  const errors = [];
  const fullName = (params.get("full_name") ?? "").trim();
  const email = (params.get("email") ?? "").trim();
  const ageRaw = (params.get("age") ?? "").trim();
  const department = params.get("department") ?? "";
  const priority = params.get("priority") ?? "";
  const acceptTerms = params.get("accept_terms") === "yes";

  if (!fullName) errors.push("Full name is required");
  if (!email) {
    errors.push("Email is required");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Email must be a valid address");
  }
  if (!ageRaw) {
    errors.push("Age is required");
  } else {
    const age = Number(ageRaw);
    if (!Number.isFinite(age) || age < 18) {
      errors.push("Age must be at least 18");
    }
  }
  if (!department) errors.push("Department is required");
  if (!priority) errors.push("Priority is required");
  if (!acceptTerms) errors.push("You must accept the terms");

  const captchaARaw = (params.get("captcha_a") ?? "").trim();
  const captchaB = params.get("captcha_b") ?? "";

  if (!captchaARaw) {
    errors.push("Captcha value A is required");
  }
  if (!captchaB) {
    errors.push("Captcha value B is required");
  }
  if (captchaARaw && captchaB && !isCaptchaEquationValid(captchaARaw, captchaB)) {
    errors.push("Captcha equation is incorrect");
  }

  return { errors, valid: errors.length === 0 };
}

function renderFormErrors(errors) {
  if (errors.length === 0) return "";
  const items = errors
    .map((msg) => `<p role="alert">${escapeHtml(msg)}</p>`)
    .join("\n");
  return `<div class="alert">${items}</div>`;
}

function renderPlaygroundForm(params, errors = []) {
  const template = readStatic("playground/form.html");
  if (!template) {
    return htmlPage("Error", "<main><p>Form template missing.</p></main>");
  }

  const fullName = escapeHtml(params.get("full_name") ?? "");
  const email = escapeHtml(params.get("email") ?? "");
  const age = escapeHtml(params.get("age") ?? "");
  const contactDate = escapeHtml(params.get("contact_date") ?? "");
  const department = params.get("department") ?? "";
  const priority = params.get("priority") ?? "";
  const notifyEmail = params.get("notify_email") === "yes";
  const notifySms = params.get("notify_sms") === "yes";
  const acceptTerms = params.get("accept_terms") === "yes";
  const comments = escapeHtml(params.get("comments") ?? "");
  const captchaA = escapeHtml(params.get("captcha_a") ?? "");
  const captchaB = params.get("captcha_b") ?? "";

  const deptOptions = ["", "Engineering", "Sales", "Support"].map((value) => {
    const label =
      value === ""
        ? "Select a department"
        : value;
    const selected = department === value ? " selected" : "";
    return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
  });

  const priorityRadios = ["Low", "Medium", "High"]
    .map((value) => {
      const checked = priority === value ? " checked" : "";
      const required = value === "Low" ? " required" : "";
      return `<label><input type="radio" name="priority" value="${value}"${checked}${required}> ${value}</label>`;
    })
    .join("\n            ");

  let html = template.replace("<!--ERRORS-->", renderFormErrors(errors));
  html = html.replace(
    'name="full_name" type="text" autocomplete="name" required value=""',
    `name="full_name" type="text" autocomplete="name" required value="${fullName}"`,
  );
  html = html.replace(
    'name="email" type="email" autocomplete="email" required value=""',
    `name="email" type="email" autocomplete="email" required value="${email}"`,
  );
  html = html.replace(
    'name="age" type="number" min="18" required value=""',
    `name="age" type="number" min="18" required value="${age}"`,
  );
  html = html.replace(
    'name="contact_date" type="date" value=""',
    `name="contact_date" type="date" value="${contactDate}"`,
  );
  html = html.replace(
    `<option value="">Select a department</option>
            <option value="Engineering">Engineering</option>
            <option value="Sales">Sales</option>
            <option value="Support">Support</option>`,
    deptOptions.join("\n            "),
  );
  html = html.replace(
    `<label><input type="radio" name="priority" value="Low" required> Low</label>
            <label><input type="radio" name="priority" value="Medium"> Medium</label>
            <label><input type="radio" name="priority" value="High"> High</label>`,
    priorityRadios,
  );
  html = html.replace(
    '<input type="checkbox" name="notify_email" value="yes">',
    `<input type="checkbox" name="notify_email" value="yes"${notifyEmail ? " checked" : ""}>`,
  );
  html = html.replace(
    '<input type="checkbox" name="notify_sms" value="yes">',
    `<input type="checkbox" name="notify_sms" value="yes"${notifySms ? " checked" : ""}>`,
  );
  html = html.replace(
    '<input type="checkbox" name="accept_terms" value="yes" required>',
    `<input type="checkbox" name="accept_terms" value="yes" required${acceptTerms ? " checked" : ""}>`,
  );
  html = html.replace(
    '<textarea id="comments" name="comments"></textarea>',
    `<textarea id="comments" name="comments">${comments}</textarea>`,
  );
  html = html.replace(
    'name="captcha_a" type="number" aria-label="A" placeholder="A" value=""',
    `name="captcha_a" type="number" aria-label="A" placeholder="A" value="${captchaA}"`,
  );

  const captchaRadios = ["4", "5", "6"]
    .map((value) => {
      const checked = captchaB === value ? " checked" : "";
      return `<label>${value} <input type="radio" name="captcha_b" aria-label="B" value="${value}"${checked} /></label>`;
    })
    .join("\n                ");
  html = html.replace(
    `<label>4 <input type="radio" name="captcha_b" aria-label="B" value="4" /></label>
                <label>5 <input type="radio" name="captcha_b" aria-label="B" value="5" /></label>
                <label>6 <input type="radio" name="captcha_b" aria-label="B" value="6" /></label>`,
    captchaRadios,
  );

  return html;
}

function renderProjectsPage(session) {
  return htmlPage(
    "Projects",
    `${siteNav("login")}
<main>
  <div class="card">
    <h1>Projects</h1>
    <p>Welcome, ${escapeHtml(session.email)}</p>
    <p>You are viewing a protected page.</p>
    <p><a href="/">Back to home</a></p>
  </div>
</main>`,
  );
}

function renderSuccessPage(params) {
  const notifyParts = [];
  if (params.get("notify_email") === "yes") notifyParts.push("Email");
  if (params.get("notify_sms") === "yes") notifyParts.push("SMS");
  const notifyVia =
    notifyParts.length > 0 ? notifyParts.join(", ") : "None";

  const items = [
    `Full name: ${params.get("full_name") ?? ""}`,
    `Email: ${params.get("email") ?? ""}`,
    `Age: ${params.get("age") ?? ""}`,
    `Contact date: ${params.get("contact_date") || "Not provided"}`,
    `Department: ${params.get("department") ?? ""}`,
    `Priority: ${params.get("priority") ?? ""}`,
    `Notify via: ${notifyVia}`,
    `Comments: ${params.get("comments") || "None"}`,
  ];

  const list = items
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("\n        ");

  return htmlPage(
    "Submission successful",
    `${siteNav("form")}
<main>
  <div class="card">
    <h1>Submission successful</h1>
    <p>Your form was submitted successfully.</p>
    <ul class="success-list">
        ${list}
    </ul>
    <p style="margin-top: 1.25rem;"><a class="btn" href="/playground/form">Submit another</a></p>
  </div>
</main>`,
  );
}

async function handlePostLogin(req, res) {
  const body = await readBody(req);
  const params = parseUrlEncodedBody(body);
  const email = params.get("email") ?? "";
  const password = params.get("password") ?? "";
  if (email === DEMO_EMAIL && password === DEMO_PASSWORD) {
    const sessionId = randomBytes(16).toString("hex");
    sessions.set(sessionId, { email: DEMO_EMAIL });
    setSessionCookie(res, sessionId);
    redirect(res, "/projects");
    return;
  }
  redirect(res, "/login?error=1");
}

async function handlePostPlaygroundForm(req, res) {
  const body = await readBody(req);
  const params = parseUrlEncodedBody(body);
  const { errors, valid } = validatePlaygroundForm(params);

  if (!valid) {
    sendHtml(res, 400, renderPlaygroundForm(params, errors));
    return;
  }

  const query = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    query.append(key, value);
  }
  redirect(res, `/playground/success?${query.toString()}`);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    const pathname = url.pathname;

    if (req.method === "POST" && pathname === "/login") {
      await handlePostLogin(req, res);
      return;
    }

    if (req.method === "POST" && pathname === "/playground/form") {
      await handlePostPlaygroundForm(req, res);
      return;
    }

    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method Not Allowed");
      return;
    }

    if (pathname.startsWith("/assets/")) {
      serveStatic(res, pathname.slice(1));
      return;
    }

    if (pathname === "/" || pathname === "/index.html") {
      serveStatic(res, "index.html");
      return;
    }

    if (pathname === "/login") {
      if (getSession(req)) {
        redirect(res, "/projects");
        return;
      }
      serveStatic(res, "login.html");
      return;
    }

    if (pathname === "/playground/form") {
      const template = readStatic("playground/form.html");
      if (!template) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not Found");
        return;
      }
      sendHtml(res, 200, template.replace("<!--ERRORS-->", ""));
      return;
    }

    if (pathname === "/playground/success") {
      sendHtml(res, 200, renderSuccessPage(url.searchParams));
      return;
    }

    if (pathname === "/projects") {
      const session = getSession(req);
      if (!session) {
        redirect(res, "/login");
        return;
      }
      sendHtml(res, 200, renderProjectsPage(session));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(err instanceof Error ? err.message : "Internal Server Error");
  }
});

server.listen(port, host, () => {
  process.stdout.write(
    `PQA demo site http://${host}:${port}\n` +
      `  /                  Home\n` +
      `  /playground/form   Form playground (incl. captcha)\n` +
      `  /login             Sign in (${DEMO_EMAIL} / ${DEMO_PASSWORD})\n` +
      `  /projects          Protected page (after login)\n`,
  );
});
