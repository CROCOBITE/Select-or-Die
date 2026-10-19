---
id: RELNOTES
title: Release Notes Template & Week Conclusion Checklist
type: release-notes
gate: G5
owner: {{pm}}
status: Template v1
---

# Release Notes – {{project}} · Sprint {{sprint}} ({{dates}})

| Field | Value |
|---|---|
| Release / build | {{release}} |
| Environment | {{env}} (Dev / SIT / Prelive / Live) |
| Teams contributing | {{teams}} |
| Prepared by | {{pm}} |
| Approved by | {{approver}} |

## 1. What's new (by business function, not by ticket)
| Story | Business function | What the user can now do | Source ref |
|---|---|---|---|

## 2. Changed behaviour users must know
| Area | Before | After | Training needed? |
|---|---|---|---|

## 3. Fixed
| ID | Problem | Fix |
|---|---|---|

## 4. Known issues and workarounds
| ID | Issue | Workaround | Owner | Target fix |
|---|---|---|---|---|

## 5. Deployment notes
- Pre-deployment scripts (DBA): {{scripts}}
- Configuration changes (governed table, BR-31): {{config}}
- Rollback plan: {{rollback}}

## 6. Acceptance evidence
| Acceptance criterion | Result | Evidence link |
|---|---|---|

---

# Week Conclusion Checklist – what the PM needs before closing each week

| # | Item | Source | Done? |
|---|---|---|---|
| 1 | RAID updated **first** (new risks/issues; risks that materialised moved to Issues) | RAID | ☐ |
| 2 | Carryover fate checked by live pull (re-planned / descoped / stranded) | ADO | ☐ |
| 3 | Teams chat log imported; decisions and actions extracted with owner and date | Teams export | ☐ |
| 4 | Status of work not visible in ADO received | Workstream leads | ☐ |
| 5 | Every action has Owner · Due date · RAG · Status | RAID Actions | ☐ |
| 6 | Decisions required written with options, consequence, recommendation and date | Report A8 | ☐ |
| 7 | Release notes drafted for anything deployed this week | This template | ☐ |
| 8 | Phase Zero version saved and signed off for each changed artifact | Phase Zero history | ☐ |
| 9 | Corrections issued for any figure already sent that was wrong (rule 8) | Correction note | ☐ |
| 10 | Thursday data-request pack issued for next week | Weekly inputs table | ☐ |
