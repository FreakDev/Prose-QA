# Prose-QA — Guide pas à pas

Ce guide présente les fonctionnalités essentielles de **Prose-QA** (PQA) dans un ordre progressif : du format de scénario jusqu’à l’analyse post-run. Chaque section s’appuie sur la précédente.

**Prérequis communs**

- Node.js 24+ (voir `engines` dans `package.json`)
- Une clé API LLM (`ANTHROPIC_API_KEY`, `FIREWORKS_API_KEY`, etc.)
- Installation du package et du navigateur :

```bash
npm ci && npm run build
npx agent-browser install
export ANTHROPIC_API_KEY=...   # ou autre provider
```

**Fil rouge** : le scénario [`scenarios/hello-world-smoke.md`](../scenarios/hello-world-smoke.md) et le serveur local :

```bash
npm run smoke:server   # http://127.0.0.1:8080/ → "Hello World"
```

---

## 1. Format scénario (Goal / Steps / Then + frontmatter)

Un scénario PQA est un fichier Markdown avec **trois sections obligatoires** et un bloc YAML en tête de fichier.

### Frontmatter

| Champ     | Requis | Rôle |
| --------- | ------ | ---- |
| `name`    | oui    | Identifiant stable (kebab-case) |
| `tags`    | non    | Filtre les runs (`smoke`, `checkout`, …) |
| `url`     | non    | URL ouverte avant les Steps |
| `auth`    | non    | Profil de session (`admin`, …) — voir §7 |
| `skills`  | non    | Skills Agent supplémentaires |
| `partial` | non    | `true` = fragment inclusible, jamais exécuté seul |

### Sections

Les titres doivent être exactement : `# Goal`, `# Steps`, `# Then` (casse indifférente).

- **Goal** — une phrase : qui agit, quoi faire, critère de succès.
- **Steps** — liste numérotée ; une action observable par ligne (cliquer, remplir, naviguer).
- **Then** — **chaque checkpoint est une puce commençant par `-`**. Les lignes sans `-` ne sont pas parsées.

### Exemple minimal

```markdown
---
name: hello-world-smoke
tags: [smoke]
url: http://127.0.0.1:8080/
---

# Goal

Verify the smoke test server serves a page that displays Hello World.

# Steps

1. Confirm the page has loaded.

# Then

- url contains "127.0.0.1:8080"
- page shows "Hello World"
```

### Patterns Then recommandés

| Pattern | Exemple |
| ------- | ------- |
| URL | `- url contains "/projects"` |
| Texte visible | `- page shows "Thank you"` |
| Champ | `- cart count equals "3"` |

Évitez les formulations vagues (« le formulaire devrait marcher ») ; préférez des assertions observables.

### Checklist auteur

- [ ] `name` unique
- [ ] Les trois sections présentes
- [ ] Toutes les lignes **Then** commencent par `-`
- [ ] Pas de secrets dans le fichier (mots de passe, clés API)

Référence détaillée : skill [create-pqa-scenario](../.agents/skills/create-pqa-scenario/SKILL.md).

---

## 2. Agent + agent-browser (snapshots, checkpoints vérifiables)

PQA ne pilote pas le navigateur en TypeScript : un **agent LLM** exécute des commandes **`agent-browser`** en bash (skill `core` vendu dans `skills/agent-browser/`).

### Boucle Observe → Act → Verify

1. **Snapshot** avant toute interaction UI (`agent-browser snapshot -i`).
2. **Action** sur une ref (`@eN`) ou un sélecteur sémantique — **une seule commande UI par appel bash**.
3. **Re-snapshot** après navigation, submit ou changement DOM.

Le prompt système ([`prompt/SYSTEM.md`](../prompt/SYSTEM.md)) impose cette boucle et interdit `curl`/`wget` pour tester l’UI.

### Vérification des Then

Après les Steps, l’agent vérifie **chaque** checkpoint Then avec la CLI :

| Checkpoint | Commande typique |
| ---------- | ---------------- |
| `url contains "…"` | `agent-browser get url` |
| `page shows "…"` | `agent-browser snapshot -i` (texte présent) |

En cas d’échec, des artefacts sont écrits dans `$PQA_ARTIFACT_DIR` (screenshot + snapshot JSON).

### Verdict final

L’agent termine par un bloc JSON structuré (pass/fail par checkpoint). Le harness parse ce verdict pour le rapport.

**À retenir** : les scénarios décrivent l’**intention** ; l’agent choisit les refs et commandes concrètes à partir des snapshots.

---

## 3. `debug` vs `run`

| | `pqa debug` | `pqa run` |
| --- | --- | --- |
| Usage | Développement, investigation | CI, régression batch |
| Navigateur | Headed par défaut | Headless par défaut |
| Verbosité | `--verbose` recommandé | Sortie concise |
| Un scénario | Oui | Oui ou plusieurs globs |

### Debug (un scénario, visible)

```bash
npm run smoke:server &
npm run dev -- debug scenarios/hello-world-smoke.md --verbose
```

Options utiles : `--headed` / `--no-headed`, `--tag` / `--tags`.

### Run (batch, CI)

```bash
npm run dev -- run scenarios/**/*.md --tags smoke
```

Codes de sortie : `0` = succès · `1` = échec scénario · `2` = erreur config/harness.

Configuration navigateur par défaut : [`pqa.config.ts`](../pqa.config.ts) → `browser.headed`, `defaultTimeout`, etc.

---

## 4. Tags et batch

Les tags dans le frontmatter permettent de **sélectionner** les scénarios sans lister chaque fichier.

```bash
# Tous les scénarios tagués smoke
pqa run scenarios/**/*.md --tags smoke

# AND : smoke ET checkout
pqa run scenarios/**/*.md --tags smoke,checkout

# NOT : p0 mais pas smoke
pqa run scenarios/**/*.md --tags p0,!smoke

# OR : plusieurs --tag
pqa run scenarios/**/*.md --tag smoke --tag checkout
```

Les scénarios **auth** (`tags: [auth]`) et les **partials** (`partial: true`) ne sont en général pas lancés en batch : l’auth est déclenchée à la demande (§7).

---

## 5. Rapports

Chaque run écrit des artefacts sous **`.pqa/runs/<runId>/`** :

| Fichier | Contenu |
| ------- | ------- |
| `report.json` / `report.html` | Résumé du run |
| `<scenario>/transcript.json` | Commandes bash + messages agent |
| `<scenario>/verdict.json` | Pass/fail structuré par checkpoint |

En cas d’échec en debug, ouvrez `report.html` et le `transcript.json` du scénario pour suivre snapshot → action → vérification.

Les variables listées dans `envVars` / `sensitiveEnvVars` (config) sont **masquées** dans les rapports ; les valeurs de secrets ne doivent pas apparaître en clair.

---

## 6. CI

Intégrer PQA dans un pipeline revient à : installer le navigateur, démarrer l’app (ou un serveur smoke), lancer `pqa run`, publier les artefacts en cas d’échec.

Exemple dans ce dépôt : [`.github/workflows/smoke_tests.yml`](../.github/workflows/smoke_tests.yml).

```yaml
- run: npx agent-browser install --with-deps
- run: npm run build
- run: |
    node scripts/smoke-hello-server.mjs &
    # attendre que http://127.0.0.1:8080/ réponde
- run: node dist/cli/index.js run scenarios/hello-world-smoke.md
  env:
    FIREWORKS_API_KEY: ${{ secrets.FIREWORKS_API_KEY }}
    PQA_LLM_PROVIDER: fireworks
```

Bonnes pratiques :

- Secrets GitHub → `ANTHROPIC_API_KEY`, `PQA_TEST_EMAIL`, etc.
- `envVars` dans `pqa.config.json` pour les creds de test
- `--tags smoke` pour limiter la portée
- Upload de `.pqa/runs/` sur échec (`actions/upload-artifact`)

Optionnel : `--retries 1 --retries-policy transient` (§11), pre-seed auth (§7).

---

## 7. Auth hybride

Pour les pages protégées, ne **pas** dupliquer le login dans chaque scénario. Utilisez un **profil auth** et un scénario de login dédié.

### Serveur de démo (ce dépôt)

Le serveur smoke expose un login et une page protégée :

```bash
npm run smoke:server
# Credentials : demo@pqa.local / demo-password (voir .env.example)
```

Routes : `/` (Hello World) · `/login` · `/projects` (protégée, cookie de session).

### Scénario auth (on-demand)

[`scenarios/auth/login-admin.md`](../scenarios/auth/login-admin.md) :

```markdown
---
name: login-admin
tags: [auth]
url: http://127.0.0.1:8080/login
---

# Goal
Authenticate as an admin test user.

# Steps
1. Open the login page.
2. Sign in using `$PQA_TEST_EMAIL` and `$PQA_TEST_PASSWORD` from the environment.
3. Confirm you reach an authenticated area.

# Then
- url does not contain "/login"
```

Le `name` doit correspondre à `auth.admin.scenario` dans la config.

### Scénario consommateur

```markdown
---
name: example-authenticated
tags: [smoke, auth-demo]
auth: admin
url: http://127.0.0.1:8080/projects
---
```

Démo locale :

```bash
npm run smoke:server &
export PQA_TEST_EMAIL=demo@pqa.local
export PQA_TEST_PASSWORD=demo-password
pqa debug scenarios/example-authenticated.md --verbose
```

Le harness charge `.pqa/auth/admin.json` ou exécute `login-admin` une fois, sauvegarde l’état navigateur, puis ouvre l’URL avec `$AGENT_BROWSER_STATE`.

### CLI auth

```bash
pqa auth list
pqa auth clear admin
pqa auth save admin          # force un login + sauvegarde
pqa run scenarios/**/*.md --auth-refresh   # invalide et refait l’auth
```

Configurer dans `pqa.config.json` :

```json
{
  "envVars": ["PQA_TEST_EMAIL", "PQA_TEST_PASSWORD"],
  "sensitiveEnvVars": ["PQA_TEST_EMAIL", "PQA_TEST_PASSWORD"],
  "auth": {
    "admin": {
      "scenario": "login-admin",
      "statePath": ".pqa/auth/admin.json"
    }
  }
}
```

**Ne jamais** mettre de mots de passe dans les fichiers scénario — uniquement `$PQA_TEST_*` dans les Steps auth.

---

## 8. MCP + skill auteur

Pour **Cursor**, Claude Desktop, etc., le serveur MCP expose l’écriture et l’exécution de scénarios sans quitter l’IDE.

```bash
pqa mcp
# ou depuis ce repo :
npm run mcp
```

### Configuration Cursor (projet consommateur)

```json
{
  "mcpServers": {
    "prose-qa": {
      "command": "npx",
      "args": ["-y", "prose-qa", "mcp"],
      "cwd": "/chemin/vers/votre-app-avec-pqa.config"
    }
  }
}
```

### Surfaces MCP

| Surface | Rôle |
| ------- | ---- |
| Resource `pqa://skill/create-pqa-scenario` | Skill complet d’auteur de scénarios |
| `get_create_pqa_scenario_skill` | Même contenu en texte |
| `validate_scenario` | Parse le markdown **sans** lancer le navigateur |
| `run_scenario` | Exécute un scénario inline (LLM + browser requis) |
| Prompt `author_pqa_scenario` | Template guidé avec la skill |

Workflow typique : demander à l’agent d’**author** un scénario → `validate_scenario` → `run_scenario` ou commit dans `scenarios/`.

---

## 9. Record → markdown

Enregistrer des actions dans le navigateur et produire un **brouillon** de scénario via LLM.

```bash
pqa record start --url http://localhost:3000/projects
pqa record note "contexte optionnel pour le LLM"
# interagir dans le navigateur (session headed)
pqa record checkpoint 'page shows "Projects"'
pqa record stop --name my-flow
pqa debug scenarios/recorded/my-flow.md --verbose
```

- Événements : `.pqa/recordings/<timestamp>/events.jsonl`
- Snapshots : `.pqa/recordings/.../snapshots/`
- Fichier généré : `scenarios/recorded/<name>.md` (tag par défaut `recorded`)

**Après génération**, éditer le fichier : condenser les Steps, ajouter `auth:`, `tags`, partials, checkpoints Then précis.

Régénérer depuis un enregistrement sauvegardé :

```bash
pqa record generate .pqa/recordings/<timestamp>
```

Extension Chrome (WIP) : voir [`recorder-extension/README.md`](../recorder-extension/README.md).

---

## 10. Cache replay

Après un **PASS**, PQA peut générer des **replay hints** (second passage LLM sur le transcript) dans `.pqa/cache/<scenario-name>/` (`hints.md` + `meta.json`). Au run suivant, ces hints sont injectés dans le prompt pour réutiliser des chemins `agent-browser` déjà validés.

```bash
# Premier run : exécution complète + génération des hints
pqa run scenarios/hello-world-smoke.md

# Deuxième run : hints utilisés si le contenu du scénario est inchangé
pqa run scenarios/hello-world-smoke.md

# Désactiver lecture/écriture
pqa run scenarios/**/*.md --no-cache

# Invalider
pqa clear-cache hello-world-smoke
pqa clear-cache
```

Le cache est **invalidé** si le hash du scénario change (Goal, Steps, Then, frontmatter, includes). Les runs en échec ne mettent pas à jour le cache.

Config : `cache.dir`, `cache.enabled` dans `pqa.config.*`.

---

## 11. Healing / retries

**Self-healing conservateur** (activé par défaut via `healing.enabled`) :

1. **Recovery in-run** — après un verdict d’échec, re-vérification des checkpoints échoués uniquement (même session), pour erreurs **transitoires** (timeout, ref stale, navigation).
2. **Retry scénario** — relance complète du scénario si l’échec est classé transitoire.

Les checkpoints **ne sont jamais assouplis** automatiquement.

```bash
# CI : une retry pour les flakes
pqa run scenarios/**/*.md --retries 1 --retries-policy transient

# Désactiver tout healing
pqa run scenarios/**/*.md --no-healing

# Retry même sur échecs non classés transitoires
pqa run scenarios/**/*.md --retries 2 --retries-policy always
```

Les passes après recovery sont marquées `healing.used: true` dans les rapports.

---

## 12. Analyze

Analyser les runs passés pour comprendre les échecs ou détecter la **flakiness**.

```bash
# Dernier run — REPL interactif (suggestions de patch)
pqa analyze

# Comparer les N derniers runs
pqa analyze --last 10
```

Sorties typiques :

- `.pqa/runs/<runId>/analyze.json` et `analyze-llm.json` (run unique)
- `.pqa/analyze/<timestamp>/` pour l’analyse multi-run flaky

Prompts associés : [`prompt/ANALYZE.md`](../prompt/ANALYZE.md), [`prompt/ANALYZE-FLAKY.md`](../prompt/ANALYZE-FLAKY.md).

---

## Parcours rapide (30 min)

| Minute | Section | Action |
| ------ | ------- | ------ |
| 0–10 | §1–2 | Lire `hello-world-smoke.md`, lancer `debug --verbose` |
| 10–15 | §3–4 | `run` avec `--tags smoke` |
| 15–20 | §5 | Ouvrir `report.html` du dernier run |
| 20–30 | §6 | Parcourir `smoke_tests.yml` |

Sections §7–12 : atelier séparé sur une vraie application ou en approfondissement.

---

## Voir aussi

- [README.md](../README.md) — install, configuration complète, CLI
- [CONTRIBUTING.md](../CONTRIBUTING.md) — contribution au dépôt
- [SECURITY.md](../SECURITY.md) — secrets et artefacts
