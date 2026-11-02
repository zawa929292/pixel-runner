<!--
Derived from: anthropics/claude-code-security-review
  Repository: https://github.com/anthropics/claude-code-security-review
  Commit:     0c6a49f1fa56a1d472575da86a94dbc1edb78eda
  File:       .claude/commands/security-review.md (section "FALSE POSITIVE FILTERING")
License: MIT License, Copyright (c) 2025 Anthropic
  Full text: .github/security-review/LICENSE.claude-code-security-review
Modifications for Pixel Runner (GAM-7):
  - Extracted only HARD EXCLUSIONS, PRECEDENTS, SIGNAL QUALITY CRITERIA and the 1-10 confidence scale; removed the "> " quote markers
  - Renumbered HARD EXCLUSIONS: upstream had two items numbered 16; they are now 16, 17 and the former 17 is 18
  - Removed the leading sentence about not running commands / not using the bash tool (it targeted the upstream sub-task flow; the audit here fetches the diff with gh before filtering)
  - Removed sentences about sub-tasks (the upstream "START ANALYSIS" steps are not included; filtering is Phase 4 in audit-prompt.md)
  - Added the "Pixel Runner additions (not from upstream)" section at the end
-->

# False positive filtering

Apply these rules to every candidate finding (Phase 4 of `audit-prompt.md`).

HARD EXCLUSIONS - Automatically exclude findings matching these patterns:
1. Denial of Service (DOS) vulnerabilities or resource exhaustion attacks.
2. Secrets or credentials stored on disk if they are otherwise secured.
3. Rate limiting concerns or service overload scenarios.
4. Memory consumption or CPU exhaustion issues.
5. Lack of input validation on non-security-critical fields without proven security impact.
6. Input sanitization concerns for GitHub Action workflows unless they are clearly triggerable via untrusted input.
7. A lack of hardening measures. Code is not expected to implement all security best practices, only flag concrete vulnerabilities.
8. Race conditions or timing attacks that are theoretical rather than practical issues. Only report a race condition if it is concretely problematic.
9. Vulnerabilities related to outdated third-party libraries. These are managed separately and should not be reported here.
10. Memory safety issues such as buffer overflows or use-after-free-vulnerabilities are impossible in rust. Do not report memory safety issues in rust or any other memory safe languages.
11. Files that are only unit tests or only used as part of running tests.
12. Log spoofing concerns. Outputting un-sanitized user input to logs is not a vulnerability.
13. SSRF vulnerabilities that only control the path. SSRF is only a concern if it can control the host or protocol.
14. Including user-controlled content in AI system prompts is not a vulnerability.
15. Regex injection. Injecting untrusted content into a regex is not a vulnerability.
16. Regex DOS concerns.
17. Insecure documentation. Do not report any findings in documentation files such as markdown files.
18. A lack of audit logs is not a vulnerability.

PRECEDENTS -
1. Logging high value secrets in plaintext is a vulnerability. Logging URLs is assumed to be safe.
2. UUIDs can be assumed to be unguessable and do not need to be validated.
3. Environment variables and CLI flags are trusted values. Attackers are generally not able to modify them in a secure environment. Any attack that relies on controlling an environment variable is invalid.
4. Resource management issues such as memory or file descriptor leaks are not valid.
5. Subtle or low impact web vulnerabilities such as tabnabbing, XS-Leaks, prototype pollution, and open redirects should not be reported unless they are extremely high confidence.
6. React and Angular are generally secure against XSS. These frameworks do not need to sanitize or escape user input unless it is using dangerouslySetInnerHTML, bypassSecurityTrustHtml, or similar methods. Do not report XSS vulnerabilities in React or Angular components or tsx files unless they are using unsafe methods.
7. Most vulnerabilities in github action workflows are not exploitable in practice. Before validating a github action workflow vulnerability ensure it is concrete and has a very specific attack path.
8. A lack of permission checking or authentication in client-side JS/TS code is not a vulnerability. Client-side code is not trusted and does not need to implement these checks, they are handled on the server-side. The same applies to all flows that send untrusted data to the backend, the backend is responsible for validating and sanitizing all inputs.
9. Only include MEDIUM findings if they are obvious and concrete issues.
10. Most vulnerabilities in ipython notebooks (*.ipynb files) are not exploitable in practice. Before validating a notebook vulnerability ensure it is concrete and has a very specific attack path where untrusted input can trigger the vulnerability.
11. Logging non-PII data is not a vulnerability even if the data may be sensitive. Only report logging vulnerabilities if they expose sensitive information such as secrets, passwords, or personally identifiable information (PII).
12. Command injection vulnerabilities in shell scripts are generally not exploitable in practice since shell scripts generally do not run with untrusted user input. Only report command injection vulnerabilities in shell scripts if they are concrete and have a very specific attack path for untrusted input.

SIGNAL QUALITY CRITERIA - For remaining findings, assess:
1. Is there a concrete, exploitable vulnerability with a clear attack path?
2. Does this represent a real security risk vs theoretical best practice?
3. Are there specific code locations and reproduction steps?
4. Would this finding be actionable for a security team?

For each finding, assign a confidence score from 1-10:
- 1-3: Low confidence, likely false positive or noise
- 4-6: Medium confidence, needs investigation
- 7-10: High confidence, likely true vulnerability

## Pixel Runner additions (not from upstream)

- Pixel Runner is a static browser game with no backend (served from GitHub Pages). Server-side vulnerability categories (SQL injection and the like) usually do not apply.
- However, if a value from `location.search`, `location.hash`, `postMessage`, `localStorage` or `document.referrer` reaches `eval`, `new Function`, `setTimeout` / `setInterval` with a string argument, `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write`, report it as DOM-based code execution / XSS with severity **HIGH**: a crafted URL lets an attacker run arbitrary script in the victim's browser. Upstream PRECEDENTS 8 (no authorization checks in client-side code is not a vulnerability) is **not** a reason to exclude such a finding.
- `.github/workflows/*.yml` and `scripts/*.mjs` run on CI with secrets. Keep upstream PRECEDENTS 7 and 12, but do report cases where externally supplied values (PR title, PR body, branch name, Linear issue title, etc.) are placed into a shell command or an `execSync` command string.
- Only findings with a confidence score of 8 or higher are kept (scores below 8 are dropped). Output the kept findings with `confidence` = score / 10.
