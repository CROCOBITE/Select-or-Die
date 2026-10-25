# Phase Zero and Minutes Desk – documentation

This repository started as **Select or Die**, a jQuery plugin from 2014 that styles `<select>` elements. It
lives in `_src/`, `_themes/` and `_demo/` and is unchanged. In October 2026 two local-first tools for project
managers in a PMO were added beside it:

| Folder | What it is | Built with | Tests |
|---|---|---|---|
| [`phase-zero/`](../phase-zero/README.md) | Business-analysis and PMO workspace. A business goal becomes a charter, user stories, a plan, a RAID log, weekly-report and release-notes drafts, all with version control, skill-based reviews and stage gates. | Node 22 (no runtime dependencies), React + Vite | 30 |
| [`minutes-desk/`](../minutes-desk/README.md) | Recordings-to-minutes for Arabic and English meetings. Video, audio, Teams transcripts, WhatsApp exports or notes become minutes for committees and stakeholders. | Python 3.10+ (standard-library server), plain JavaScript page, optional Whisper models | 30 |

Both tools run **on your own computer**, bind to `127.0.0.1`, and keep organisation content in a git-ignored
`workspace/` folder. The repository is public, so it holds code and invented sample data only.

- [1. The whole picture](#1-the-whole-picture)
- [2. Phase Zero](#2-phase-zero)
- [3. Minutes Desk](#3-minutes-desk)
- [4. Skills: how the PMO rules are built into the code](#4-skills-how-the-pmo-rules-are-built-into-the-code)
- [5. Privacy and security model](#5-privacy-and-security-model)
- [6. Quality: tests, measurements and checks](#6-quality-tests-measurements-and-checks)
- [7. Change log](#7-change-log)

---

## 1. The whole picture

```mermaid
flowchart LR
  subgraph PC["Project manager's computer"]
    direction TB
    PZ["Phase Zero<br/>127.0.0.1:4317"]
    MD["Minutes Desk<br/>127.0.0.1:4330"]
    WS[("workspace/<br/>private, git-ignored<br/>projects · meetings · skills · config")]
    PZ --- WS
    MD --- WS
  end
  PM(["Project manager"]) --> PZ
  PM --> MD
  MD -. "model download, once" .-> HF["Hugging Face<br/>Whisper dialect models"]
  PZ -. "live review, only after confirm" .-> CL["Claude API"]
  MD -. "draft, only after confirm<br/>redacted" .-> CL
  PZ -- "manifest after exact<br/>approval phrase" --> OUT["outbox/*.json"]
  OUT -. "published by the PM" .-> ADO["Azure DevOps"]
  MD -- "“MOM:” line, pasted by the PM" --> ADO
  GH["GitHub (this repo)<br/>code + invented demo data"] -. "git pull" .-> PC
```

Dotted lines are optional or manual. Nothing leaves the computer without a person acting. **Neither tool writes
to Azure DevOps by itself.**

### Quick start

```bash
# Phase Zero
cd phase-zero && npm install && npm run build && npm start      # http://127.0.0.1:4317

# Minutes Desk (Windows: scripts\install-windows.bat, then scripts\start-windows.bat)
cd minutes-desk && scripts/install.sh && scripts/start.sh         # http://127.0.0.1:4330
```

---

## 2. Phase Zero

### 2.1 What a project manager does with it

```mermaid
flowchart TD
  A["Business goal, problem,<br/>objectives, capabilities, risks"] --> B["Generator<br/>drafts 6 artifacts"]
  B --> C["Charter · Stories with AC · Plan (WBS, gates)<br/>RAID log · Weekly report · Release notes"]
  C --> D{"Edit and save"}
  D -->|"every save = new version<br/>(author, message, sha)"| E["Version history<br/>diff · restore · sign-off"]
  E --> F["Skill reviews<br/>offline, or live after confirm"]
  F -->|findings| D
  F --> G["Stage gates G0–G5<br/>steps, evidence, questions"]
  G --> H["ADO preview<br/>Epic → Feature → Requirement"]
  H --> I{"Typed approval phrase<br/>matches exactly?"}
  I -->|no| H
  I -->|yes| J["Manifest written to<br/>workspace/outbox/"]
  C --> K["Exports: Markdown · Word · Excel · executive HTML"]
  L["Teams chat log · meeting notes · ticket CSV"] --> M["RAID candidates · minutes · ticket analysis"]
  M --> D
```

### 2.2 Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI["React app (web/dist)<br/>Dashboard · Gates · Artifacts · Teams · Minutes<br/>Tickets · Publish · Code review · Skills"]
  end
  subgraph Server["Node server – server/index.mjs (node:http)"]
    R["Router + guards<br/>Host check · X-Phase-Zero header · 5 MB limit"]
    G["generator.mjs"]
    RV["reviews.mjs · integrity.mjs<br/>leadership.mjs · executive.mjs"]
    T["teams.mjs · minutes.mjs<br/>integrity.analyseTickets"]
    X["md.mjs · diff.mjs · dashboard.mjs"]
    E["docx.mjs · xlsx.mjs · zip.mjs"]
    A["ado.mjs (manifest only)"]
    AI["ai.mjs (redact, then Claude)"]
    S["store.mjs<br/>append-only versions, audit"]
  end
  UI -- "fetch /api/*" --> R
  R --> G & RV & T & X & E & A & AI
  G & RV & T & A --> S
  S --> DB[("workspace/phase-zero.db.json")]
  S --> P[("workspace/projects/*/*.md")]
  A --> O[("workspace/outbox/")]
```

| Module | Responsibility |
|---|---|
| `server/index.mjs` | Routes, security guards, seeding projects from `workspace/projects/` and `demo/`, static files |
| `lib/store.mjs` | JSON store: projects, artifacts, append-only versions with sha, sign-offs, reviews, gates, approvals, audit |
| `lib/generator.mjs` | Business goal → six draft artifacts; anything not given is "not set" / "TBC – requires assignment" |
| `lib/md.mjs` | Front matter, tables and story parsing (`## EP` / `### FE` / `#### US`) |
| `lib/diff.mjs` | Line diff (LCS) between any two versions |
| `lib/reviews.mjs` | Offline reviewers: INVEST + DoR, Use Case Points, NFR coverage, solution value, charter, RAID discipline, weekly structure, rollout, report integrity, diagnostic standard, KPI reply, executive page, minutes naming; code review of the tool's own source |
| `lib/integrity.mjs` | KPI-feedback rule, "baseline" rule, evidence rule, diagnostic blocks, 5-point rule, ticket-export analyser |
| `lib/leadership.mjs`, `lib/executive.mjs` | KPI reply (Table A/B) and executive per-team page (inline SVG) |
| `lib/teams.mjs`, `lib/minutes.mjs` | Teams chat log → RAID candidates; raw notes → minutes |
| `lib/dashboard.mjs` | Decisions required, actions due in 7 days, indicators, charts – all computed from artifacts |
| `lib/docx.mjs`, `lib/xlsx.mjs`, `lib/zip.mjs` | Word and Excel exports written by hand (no library) |
| `lib/ado.mjs` | Validates the target area path and builds the Epic → Feature → Requirement manifest (no tags) |
| `lib/ai.mjs` | Optional live review with Claude: redaction, confirmation required |
| `lib/skills.mjs` | Skills checklist: purpose, benefits, boundaries, where coded |

### 2.3 Version control of an artifact

```mermaid
stateDiagram-v2
  [*] --> v1: generated or imported
  v1 --> v2: save (message required)
  v2 --> v2: identical save – no new version
  v2 --> v3: restore v1 (as a new version)
  v3 --> SignedOff: sign-off on v3
  SignedOff --> v4: any later save
  v4 --> [*]
  note right of SignedOff: sign-off is tied to the version and its sha
```

### 2.4 The Azure DevOps gate

```mermaid
sequenceDiagram
  actor PM
  participant UI as Phase Zero UI
  participant S as Server
  participant O as workspace/outbox
  PM->>UI: Publish to ADO
  UI->>S: POST /ado/preview
  S-->>UI: Epic → Feature → Requirement items from the current STORIES version
  PM->>UI: types the approval phrase (paste disabled)
  UI->>S: POST /ado/approve {phrase, target}
  alt phrase differs or target path invalid
    S-->>UI: 403 / 400, nothing written
  else exact phrase
    S->>O: manifest .json + .md, audit entry
    S-->>UI: manifest path
  end
  Note over PM,O: Phase Zero never calls Azure DevOps itself
```

### 2.5 API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/status` | Version, live-AI availability, workspace |
| GET, POST | `/api/projects` | List or create a project from a business goal |
| GET | `/api/projects/:id`, `/dashboard`, `/audit` | Project, computed dashboard, audit trail |
| POST | `/api/projects/:id/gates/:gate` | Record a gate decision |
| GET, PUT | `/api/artifacts/:id` | Read, or save a new version (message required) |
| GET | `/api/artifacts/:id/versions/:n`, `/diff` | A version, a diff between two versions |
| POST | `/api/artifacts/:id/restore`, `/signoff`, `/review` | Restore, sign off, run a review (live needs `confirm`) |
| GET | `/api/artifacts/:id/export?format=md\|docx\|xlsx\|html` | Exports |
| POST | `/api/projects/:id/ado/preview`, `/ado/approve` | ADO gate |
| POST | `/api/projects/:id/teams`, `/minutes`, `/artifacts` | Chat-log candidates, minutes, new KPI-reply or executive artifact |
| POST | `/api/tickets/analyse`, `/api/integrity/five-point`, `/api/code-review` | Ticket CSV analysis, 5-point rule, code review |
| GET | `/api/skills` | Skills checklist |

All writes need the header `X-Phase-Zero: 1`.

### 2.6 Screens (invented sample project)

| Dashboard | Gates and PMO guide |
|---|---|
| ![Phase Zero dashboard](images/pz-dashboard.png) | ![Gates](images/pz-gates.png) |
| **Artifacts and versions** | **Skills checklist** |
| ![Artifacts](images/pz-artifacts.png) | ![Skills](images/pz-skills.png) |

---

## 3. Minutes Desk

### 3.1 From a recording to issued minutes

```mermaid
flowchart TD
  IN["Add a file"] --> K{"What is it?"}
  K -->|".vtt · .srt · Teams .docx"| IMP["Import transcript<br/>speakers + times kept"]
  K -->|"WhatsApp chat.txt"| WA["Import chat<br/>phone-number senders masked<br/>overlapping exports merged"]
  K -->|".txt · .md notes"| NT["Import notes<br/>'Name: text' keeps the speaker"]
  K -->|"audio / video"| ASR["Transcribe on this computer<br/>(see 3.2)"]
  IMP & WA & NT & ASR --> FL["Flag segments<br/>hallucination · repetition · speech rate<br/>low confidence · numbers to confirm"]
  FL --> TV[("Transcript vN")]
  TV --> ED["PM corrects text in place<br/>→ new version"]
  ED --> TV
  TV --> EX["Offline extraction (Arabic + English cues)<br/>decisions · actions (owner, due) · issues + root cause<br/>conflicts · requirements · scope changes · questions"]
  EX --> TP["Template for the audience<br/>ticket · committee · steering · follow-up<br/>lecture · chat digest"]
  TP --> OD["Offline draft – minutes vN"]
  OD --> CK["Pre-issue checks + six-standard scorecard"]
  CK --> Q{"Better draft wanted?"}
  Q -->|yes| CD["Claude draft<br/>after preview + confirm (see 3.3)"]
  CD --> CK
  Q -->|no| EDM["PM edits · saves with a message"]
  CK --> EDM
  EDM --> AP["Approval recorded on the saved version<br/>any later edit clears it"]
  AP --> OUT["Word · Markdown · Teams/e-mail text · “MOM:” line"]
```

### 3.2 Speech recognition, step by step

```mermaid
flowchart TD
  F["Recording<br/>(saved at speed s: 1x, 1.5x, 1.8x, 2x)"] --> D["ffmpeg decode → mono 16 kHz<br/>atempo = pace ÷ speed"]
  D --> L{"Average level<br/>below −50 dB?"}
  L -->|yes| X["Refuse: no audible speech<br/>(Whisper would invent text)"]
  L -->|no| C["Split at quiet points<br/>±3 s around every 25 s"]
  C --> LOOP["For each chunk"]
  LOOP --> SIL{"Chunk silent?"}
  SIL -->|yes| SKIP["Skip"]
  SIL -->|no| W["Whisper dialect model<br/>language: ar · en · auto"]
  W --> R{"Text compresses<br/>too well? (loop)"}
  R -->|"yes, try 2 and 3"| W2["Decode again:<br/>block repeats, then light sampling"]
  W2 --> R
  R -->|no| SEG["Segments with times"]
  SKIP --> NEXT
  SEG --> NEXT["Next chunk"]
  NEXT --> LOOP
  NEXT --> CLK["Times × pace → meeting clock"]
  CLK --> HINT{"Median speech rate<br/>above 13 letters/s?"}
  HINT -->|yes| WARN["Warn: file may be sped up –<br/>set its speed and run again"]
  HINT -->|no| DONE["Transcript saved · recording deleted<br/>(retention setting)"]
  WARN --> DONE
```

Engine choice: `whisper` (Hugging Face transformers, any OS, CPU or GPU) or `arabic-transcribe`
([ssagga/arabic-transcribe](https://github.com/ssagga/arabic-transcribe), when installed). The model comes
from the catalogue in `minutes_desk/config.py`. Each entry records the model card's licence, and a model with no
stated licence is marked ⚠. Fine-tunes saved by newer library versions fall back to their Whisper base's
tokenizer.

### 3.3 The Claude draft: preview, confirm, send

```mermaid
sequenceDiagram
  actor PM
  participant UI as Minutes Desk page
  participant S as Local server
  participant C as Claude API
  PM->>UI: Draft with Claude…
  UI->>S: POST /claude/preview
  S->>S: offline skeleton + transcript lines → redact phones, e-mails, IDs, record numbers → sha-256
  S-->>UI: exact text to be sent, redaction counts, token estimate, sha
  UI-->>PM: shows it all, with the warning that names and patient talk are not masked
  PM->>UI: ticks "I have checked the content", Send
  UI->>S: POST /claude/draft {sha, confirm: true}
  S->>S: rebuild the payload, compare sha
  alt sha differs or confirm missing
    S-->>UI: 403 – preview again
  else matches
    S->>C: system rules + skill texts, redacted user content
    C-->>S: Markdown minutes
    S->>S: naming rule, save as a new minutes version, audit "claude-send"
    S-->>UI: draft + checks
  end
```

### 3.4 What the extractor recognises

| Item | Cues (English · Egyptian · Gulf · MSA, examples) | Rule |
|---|---|---|
| Decision | agreed, decided, approved · اتفقنا، قررنا، تم الاعتماد | Owner only when someone was named |
| Action | I will, please, needs to, follow up · لازم، مطلوب، هيعمل، هبعت · راح يسوي، بيسوي | Owner: attendee, @mention, "يا فلان", or the speaker for "I will / هبعت". Otherwise "TBC – requires assignment" |
| Due date | 30/10, tomorrow, next week, Thursday · بكرة، الأسبوع الجاي، يوم الخميس · باكر | Resolved against the meeting date, shown with what was said |
| Issue | issue, delay, blocker, error · مشكلة، واقف، متأخر، عطل | Root cause from the same sentence or one of the next two, else "Not established in the meeting" |
| Conflict | disagree, but the team says · مش موافق، بس التيم | Both sides recorded, neither chosen |
| Requirement | we need, should be able · عايزين، محتاجين، نبغى | Draft story "As a [role TBC], I want …, so that [value TBC]" |
| Scope change | new request, change request · طلب جديد، خارج النطاق | "Change request needed before work starts" |
| PMO note | My conclusion…, PMO: | Kept apart from what the meeting agreed |

### 3.5 Every template shares one spine

```mermaid
flowchart LR
  A["Document control"] --> B["Read this first"] --> C["Management summary"] --> D["Participants"]
  D --> E["Template sections<br/>ticket: Tickets discussed<br/>committee: Agenda register, What we need back<br/>steering: Table A / Table B / For decision<br/>chat digest: Activity by day"]
  E --> F["Decisions"] --> G["Actions"] --> H["Open issues and root cause"] --> I["Conflicts"]
  I --> J["Requirements and scope"] --> K["To confirm before sending<br/>(one request pack)"] --> L["PMO judgement"] --> M["Discussion – as written"]
```

The six standards scored before issue:

1. Organisation and planning: every action has an owner, a date and a status.
2. Analysis: every issue has a root cause and a next action.
3. Business context: the meeting's objective or impact is named.
4. Information gathering: open questions are in one pack, grouped by who answers.
5. Report structure: the summary, decisions, actions, issues and requests are all present.
6. Terminology: house names are used, no vague timing, "baseline" only for an approved plan.

### 3.6 Modules

| Module | Responsibility |
|---|---|
| `__main__.py` | `serve`, `doctor`, `transcribe <file> [--speed --pace --language --model]` |
| `config.py` | Defaults merged with `workspace/config.json`; model catalogue with licences; model choice by device and dialect |
| `media.py` | ffmpeg probe and decode, speed/pace filter, loudness, quiet-point chunking (adapted from ssagga/arabic-transcribe, MIT) |
| `engines.py` | Doctor checks, engine choice, Whisper pipeline with loop retries, arabic-transcribe adapter, meeting-clock rescale, speed hint |
| `importers.py` | VTT/SRT, Teams .docx, WhatsApp (iOS and Android formats, merge, masked numbers), notes |
| `arabic.py` | Normalisation for matching (alef/ya/ta marbuta, diacritics, digits), direction detection |
| `governance.py` | Segment flags, redaction, naming rule, WER/CER |
| `extract.py` | Sentence split, cue matching, owners, due dates, root-cause attachment |
| `templates.py` | The spine and the seven templates (Markdown) |
| `checks.py` | Pre-issue findings and the six-standard scorecard |
| `claude_draft.py` | Prompt rules, skill texts, redacted payload with sha, streamed call with server-side fallback |
| `docx.py` | Markdown → Word in the document palette (RTL paragraphs, A4, header, page X of Y) |
| `store.py` | Meetings on disk, append-only versions, media retention, sign-off, audit log |
| `server.py` | HTTP layer, guards, routes, background transcription jobs, exports |
| `skills.py` | Which skills the tool applies, their benefits and boundaries |
| `web/` | The page: meetings, add recording, transcript editor, minutes editor with live preview, checks, Claude confirm, approval, exports, Pilot, Doctor, Skills, Audit |

### 3.7 API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/status`, `/api/doctor`, `/api/skills`, `/api/audit` | App state, machine check, skills, audit |
| GET, POST | `/api/meetings` | List or create a meeting |
| GET | `/api/meetings/:id` | Meeting with versions and media |
| POST | `/api/meetings/:id/meta` | Change meeting details |
| POST | `/api/meetings/:id/upload?name=` | Raw upload: transcript files import at once; media is stored |
| POST | `/api/meetings/:id/transcribe` | Start a job `{engine, model, speed, pace, language}` |
| GET | `/api/jobs/:id` | Job progress |
| GET, POST | `/api/meetings/:id/transcript` | Read, or save corrections as a new version |
| POST | `/api/meetings/:id/minutes/offline` | Offline draft for a template |
| GET, POST | `/api/meetings/:id/minutes` | Read, or save (message required) |
| POST | `/api/meetings/:id/claude/preview`, `/claude/draft` | Preview, then confirmed draft |
| POST | `/api/meetings/:id/signoff` | Record approval of the saved version |
| GET | `/api/meetings/:id/export?format=docx\|md\|txt\|mom` | Exports |
| POST | `/api/meetings/:id/media/delete`, `/api/wer` | Delete recording; Pilot WER/CER |

All writes need the header `X-Minutes-Desk: 1`.

### 3.8 Screens (invented sample meeting, `minutes-desk/demo/sample-ticket-review.vtt`)

| New meeting | Transcript with flags |
|---|---|
| ![New meeting](images/md-new-meeting.png) | ![Transcript](images/md-transcript.png) |
| **Pre-issue checks and scorecard** | **Claude draft: preview and confirm** |
| ![Checks](images/md-minutes-checks.png) | ![Confirm](images/md-claude-confirm.png) |
| **Minutes preview** | **Dark theme** |
| ![Preview](images/md-minutes-preview.png) | ![Dark](images/md-minutes-dark.png) |

To try it: create a meeting, drop `demo/sample-ticket-review.vtt`, open **Minutes**, choose "Ticket / working
meeting", then **Offline draft**.

---

## 4. Skills: how the PMO rules are built into the code

The tools were built from a set of Claude skills (SKILL.md files). The skill texts are private and live in
`workspace/skills/`; the code carries only the rules. Each tool's **Skills checklist** screen lists each
skill's benefits, its boundaries and where it is coded.

```mermaid
flowchart LR
  subgraph Skills["Skill texts (private workspace)"]
    S1["Report integrity"]
    S2["RAID log"]
    S3["Weekly report"]
    S4["Leadership KPI reply"]
    S5["Executive per-team page"]
    S6["Ticket review & minutes"]
    S7["Minutes from recordings"]
    S8["Business analysis set<br/>eliciting · structuring · scope · value · UCP"]
    S9["Design system & design review"]
  end
  subgraph Code["Where they live in code"]
    C1["Phase Zero reviewers<br/>reviews.mjs · integrity.mjs"]
    C2["Phase Zero artifact types<br/>leadership.mjs · executive.mjs"]
    C3["Minutes Desk checks + scorecard<br/>checks.py"]
    C4["Minutes Desk extractor + templates<br/>extract.py · templates.py"]
    C5["Claude prompts<br/>ai.mjs · claude_draft.py"]
    C6["UI tokens, light/dark"]
  end
  S1 --> C1 & C3
  S2 --> C1 & C4
  S3 --> C1
  S4 & S5 --> C2
  S4 --> C4
  S6 & S7 --> C4 & C5
  S8 --> C1 & C4
  S9 --> C6
```

Conflicts between skills and project decisions were settled in favour of the stricter rule, and recorded:

- Skills that pre-authorised writing to Azure DevOps are overridden. Writes need the PM's exact approval phrase.
- "The wiki is empty" was outdated. The wiki git repository holds the pages; only the listing API returns none.
- "Baseline" is reserved for an approved, change-controlled plan.
- The application palette (teal and mint) and the document palette (navy and orange, no green) never mix.

---

## 5. Privacy and security model

| Concern | Phase Zero | Minutes Desk |
|---|---|---|
| Network exposure | Binds to `127.0.0.1` | Binds to `127.0.0.1` |
| DNS rebinding | Non-local `Host` → 421 | Non-local `Host` → 421 |
| Cross-site writes | `X-Phase-Zero: 1` required | `X-Minutes-Desk: 1` required |
| Static files | Confined to `web/dist` | Confined to `web/` |
| Request size | JSON 5 MB | JSON 20 MB; uploads up to the configured limit, streamed to disk |
| Data leaving the computer | Live review after confirm; e-mails and long numbers masked | Claude draft after preview + confirm + sha match; phones, e-mails, national IDs/Iqama, record numbers masked |
| Azure DevOps | Manifest to `outbox/` after the exact phrase | Never; a "MOM:" line to paste |
| Organisation content | `workspace/` git-ignored | `workspace/` git-ignored; recordings deleted after transcription |
| Traceability | Audit log of every save, review, gate, approval, export | Audit log of upload, transcription, Claude send, save, approval, export, deletion |

---

## 6. Quality: tests, measurements and checks

```bash
cd phase-zero   && npm test                               # 30 tests (node:test)
cd minutes-desk && python -m unittest discover -s tests   # 30 tests (standard library)
```

Both suites cover:

- version control and approvals;
- exports, opened and checked as valid files;
- the security guards (Host header, write header, static-path escape);
- every skill rule;
- the Arabic and English extraction;
- a function-size gate, which fails the build when a function grows past 60 lines or 12 branches.

**Measured speech-recognition accuracy** (2.5 minutes of public Egyptian Arabic speech, 4-core CPU):

| Model | Setting | Word error rate |
|---|---|---|
| Medium mixed-dialect | normal | **41.9%** |
| Medium mixed-dialect | pace 0.8x | 44.1% |
| Medium mixed-dialect | 2x file, restored | 70.3% |
| Small Egyptian | normal | 58.7% (71.4% before the loop fix) |
| Small Egyptian | 2x file, not restored | 81.3%, times at half the meeting clock |

The full table and what it means are in [`minutes-desk/README.md`](../minutes-desk/README.md#measured-accuracy).

---

## 7. Change log

```mermaid
timeline
  title October 2026
  19 Oct : Phase Zero – generator, version control, gates, reviews, exports, ADO gate, security
  21 Oct : Phase Zero – PMO skill pack (integrity, diagnostic standard, KPI reply, executive page, minutes, tickets, skills checklist, design system)
  25 Oct : Minutes Desk – local transcription, governance, minutes templates, checks, Word export
         : Fixes from real runs – sped-up warning calibrated, tokenizer fallback, generation-config fix, accuracy benchmark
         : Extractor – first-person owners, attendee first names, root cause from the next sentence, documentation
```

| Commit | Date | Change |
|---|---|---|
| `c1a0286` | 19 Oct | Add Phase Zero: local-first BA/PMO workspace with version control and skill reviews |
| `eae9d0b` | 21 Oct | Phase Zero: code the PMO skill pack into reviews, artifacts and tools |
| `a3dd522` | 25 Oct | Add Minutes Desk: local recordings-to-minutes tool for Arabic/English meetings |
| `6740f51` | 25 Oct | Calibrate the sped-up warning from measured rates; add tokenizer dependencies |
| `7a6b47a` | 25 Oct | Load a fine-tune's tokenizer from its Whisper base when its own fails |
| `87d5e52` | 25 Oct | Accept generation configs saved by newer transformers releases |
| `cca08ce` | 25 Oct | README: measured accuracy for speed, pace and model choice |
| this commit | 25 Oct | Extractor improvements, house RAG convention restored, documentation with flowcharts and screenshots |

Earlier commits (2014) are the original Select or Die jQuery plugin.
