# Prose-QA Recorder (Chrome extension)

Phase 2 browser extension for recording in your daily Chrome profile.

## Setup

1. Start the bridge from your project:

   ```bash
   pqa record start --connect 9222 --url http://localhost:3000
   ```

   Or use harness-only recording (no extension):

   ```bash
   pqa record start --url http://localhost:3000
   ```

2. Load the extension (unpacked):
   - Chrome → `chrome://extensions` → Developer mode → **Load unpacked**
   - Select this `recorder-extension/` folder

3. Launch Chrome with remote debugging when using `--connect`:

   ```bash
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
     --remote-debugging-port=9222 \
     --load-extension="$(pwd)/recorder-extension"
   ```

4. Set the bridge URL in the extension popup (default `http://127.0.0.1:17321`).

## Usage

- Interact with the app; events are sent to `.pqa/recordings/<id>/events.jsonl`.
- Use popup **Add note** / **Add checkpoint hint**, or terminal:

  ```bash
  pqa record note "intentional invalid date"
  pqa record checkpoint 'page shows "Create a new project"'
  ```

- Stop and generate:

  ```bash
  pqa record stop --name my-flow
  ```

## Limits

Cross-origin iframes, deep shadow DOM, and SSO redirects may need manual `record note` / scenario edits.
