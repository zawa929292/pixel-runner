# Project-specific security categories (Pixel Runner)

Original content for Pixel Runner (GAM-7). The format follows upstream `docs/custom-security-scan-instructions.md` of anthropics/claude-code-security-review (bold category header followed by a list of patterns).

**GitHub Actions / Harness:**
- `${{ github.event.* }}` (PR title, PR body, branch name, comment body, etc.) expanded directly inside a `run:` script instead of being passed through `env:`
- `pull_request_target` (or `workflow_run`) workflows that check out and execute the PR head code
- Secrets or tokens printed to logs (`echo`, `set -x`, debug output) or written to uploaded artifacts
- Unnecessarily broad `permissions` (e.g. `contents: write` or `pull-requests: write` granted to a job that runs an LLM or untrusted code)

**Node scripts (scripts/*.mjs):**
- `execSync` / `exec` with a command string built by concatenating external input (values from the Linear or GitHub APIs, PR titles, branch names). `execFileSync` with an argument array is safe
- Tokens or secrets (Linear / GitHub / Slack) written to logs or error messages

**Browser game (src/):**
- Values from `location.search`, `location.hash`, `postMessage`, `localStorage` or `document.referrer` reaching `eval`, `new Function`, string-argument `setTimeout` / `setInterval`, `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write`
- Exposing a writable API on `window.__GAME__` (or any other global) outside the `?test=1` test mode
