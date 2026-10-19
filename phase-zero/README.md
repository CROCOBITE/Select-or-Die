# Phase Zero

A local-first business-analysis and PMO workspace for project managers. You give it a business goal; it drafts the project charter, user stories with acceptance criteria, project plan (WBS, gates, schedule), RAID log, weekly report and release-notes templates. You then refine each artifact under **version control**, run **skill-based reviews**, sign off **stage gates**, and publish the backlog to **Azure DevOps** only after an explicit written approval.

It runs on your own computer. Nothing leaves it unless you confirm a live AI review or approve an ADO publish.

## Quick start

```bash
cd phase-zero
npm install          # dev tools for the front end + optional Claude SDK
npm run build        # builds the UI into web/dist
npm start            # http://127.0.0.1:4317
npm test             # 17 tests: version control, exports, gates, ADO approval, security headers
```

Requires Node 20+. The server has no runtime dependencies. The first start imports every project folder under `workspace/projects/` plus the neutral sample in `demo/`.

## What it does

| Area | What you get |
|---|---|
| **Generator** | Business goal, problem, objectives (`objective \| measure \| target`), capabilities (`Role: capability`), scope, risks and teams become six draft artifacts. Anything not given is written as *not set* or *TBC – requires assignment*, never guessed. |
| **Version control** | Every save is an append-only version with author, message and sha. Line diff between any two versions, restore (as a new version), sign-off per version, full audit trail. Identical saves are no-ops. |
| **Stage gates** | G0 Discovery → G1 Initiation → G2 Planning → G3 Build → G4 Quality → G5 Transition (PMBOK 8, hybrid). Each gate lists the steps, the artifact that proves each step, and the questions to answer before passing. |
| **Skill reviews (offline)** | INVEST + Definition of Ready, Use Case Points (Karner), NFR coverage, solution value of objectives, charter completeness, RAID discipline (owner · due · RAG · status · source · consequence), weekly-report locked structure, rollout readiness, and code review (security, complexity, a11y) of Phase Zero's own source. |
| **Skill reviews (live)** | Optional. Sends one artifact plus the skill's own text to Claude (`claude-opus-5-5`) **only after a confirmation dialog**. E-mails and long numbers are masked first. Needs `ANTHROPIC_API_KEY` and `npm install`. Skill texts are read from `workspace/skills/<skill>/*.md`. |
| **Dashboard** | Decisions required, then actions due in 7 days, then leading and lagging indicators, then "not supplied" tiles, then charts (schedule vs baseline, backlog by epic) with full tables. Everything is computed from the artifacts. |
| **Teams chat log** | Paste or upload a weekly Teams thread. Decisions, actions (owner and due date), risks and issues are listed as RAID candidates for you to confirm. |
| **Exports** | Markdown, Word (.docx) and Excel (.xlsx, one sheet per table) for every artifact: navy headers, zebra rows, orange High/Medium cells. |
| **ADO publish gate** | Preview Epic → Feature → Requirement items from the current STORIES version. Approval requires typing the configured phrase **exactly** (paste disabled). Approval writes a manifest to `workspace/outbox/`; Phase Zero never calls ADO itself. |

## Private workspace (never committed)

Organisation content stays out of git (`.gitignore` → `workspace/`):

```
workspace/
  config.json             # { "ado": { "project", "areaPath", "backlog", "requirementType" } }
  projects/<name>/*.md    # one folder per project, front matter: id, title, type, gate, owner, status
  projects/<name>/project.json
  skills/<skill>/*.md     # skill texts used by live reviews
  outbox/                 # approved ADO publish manifests (.json + .md)
  phase-zero.db.json      # versions, sign-offs, reviews, gates, approvals, audit
```

Set `PHASE_ZERO_WORKSPACE=/path/to/folder` to keep it anywhere else, for example a synced private drive.

## Artifact format

Artifacts are Markdown with a small front matter. Stories use `## EP-xx · Epic`, `### FE-xx.y · Feature` and `#### US-nnn · Story`, followed by the fields `Story`, `Priority · Phase · Team`, `Source`, `Acceptance criteria` (numbered Given/When/Then), `Dependencies`, `Privacy`, `Estimate` and `Open questions`. See `demo/sample-clinic-booking/`.

## Security model

- Binds to `127.0.0.1` by default (`HOST`, `PORT` to change).
- Requests with a non-local `Host` are refused (DNS rebinding). Every write needs the `X-Phase-Zero: 1` header, so a web page in another tab cannot forge requests.
- Static file serving is confined to `web/dist`. JSON bodies are limited to 5 MB.
- Live AI and ADO publishing both require an explicit human action and are recorded in the audit log.
