---
id: WEEKLY
title: PMO Weekly Report Template (Document A + B)
type: weekly
gate: G5
owner: {{pm}}
status: Template v1
---

# PMO Weekly Report – {{project}} · Week of {{week_start}} – {{week_end}}

| Document control | |
|---|---|
| Version | {{version}} |
| Issue date | {{issue_date}} |
| Next issue | {{next_issue_date}} |
| Prepared by | {{pm}} |
| Approver | {{approver}} |
| Approach | {{approach}} |
| Tailoring | Domains not reported this week: {{domains_not_reported}} – cost of omission: {{omission_cost}} |

> **Structure is locked.** Every section appears every week. If a section's input was not supplied, it shows **"Not supplied this week – owner TBC"** instead of disappearing.

---

## Document A – Delivery Report (to the approver)

### A0. Executive summary
1. {{point_1}}
2. {{point_2}}
3. {{point_3}}
4. {{point_4}}
5. {{point_5}}

**Recommendation:** {{recommendation}}

### A1. Status (Governance)
| Scope | RAG | One-line reason |
|---|---|---|
| {{project}} overall | {{rag}} | {{reason}} |
{{team_rows}}

### A2. Progress and forecast (Governance · Schedule)
| Team | Sprint (by dates) | Target | Done | Achieved % | Variance vs baseline |
|---|---|---|---|---|---|

Week-over-week:
| Week | Target | Done | Achieved % |
|---|---|---|---|

**Forecast:** {{forecast}} — **Assumption:** {{assumption}} — **What breaks it:** {{breaker}}

### A3. Value delivered (Focus on Value)
| Business function | Module (ADO) | What the organisation gets | Site ({{sites}}) |
|---|---|---|---|

### A4. Risks – top 5 from RAID (Risk)
| ID | Risk | RAG | Owner | Mitigation |
|---|---|---|---|---|

### A5. Issues – top 5 open (Governance)
| ID | Issue | Age (days) | Business impact | Owner |
|---|---|---|---|---|

### A5a. Carryover and incomplete work (Schedule)
| Item | Team | Fate (Re-planned / Descoped / **Stranded**) | Evidence |
|---|---|---|---|

> Carryover check: verified by live pull. If no item was re-planned, completion % is **not comparable week to week**.

### A6. Dependencies (Governance · Resources)
| ID | Who waits | On whom | Required by | Status |
|---|---|---|---|---|

### A7. Actions (Accountable leadership)
| ID | Action | Owner | Due date | RAG | Status |
|---|---|---|---|---|---|

### A8. Decisions required (Governance)
| # | Decision | Options and consequence | Recommendation | From | Needed by |
|---|---|---|---|---|---|

### A9. Deliveries by team (Scope) – English only, no weight figures
- **{{team}} – {{theme}} ({{done}} of {{target}} delivered)**
  - {{delivery}}

### A10. Appendix – evidence
Ticket tables · documentation coverage (recomputed per team) · AI consumption (units as exported) · data-quality notes.

### A10a. Convergent view
| Team | Delivery | Workload split | Outside-sprint share | Tagging quality | Agree? |
|---|---|---|---|---|---|

### A11. Domain coverage (Tailoring)
| PMBOK 8 domain | Reported? | If not – cost |
|---|---|---|
| Governance | | |
| Scope | | |
| Schedule | | |
| Finance | | |
| Stakeholders | | |
| Resources | | |
| Risk | | |

---

## Document B – Workload & Escalation (to the Deputy Software Director)

### B0. Period context
{{period}} · Portfolio target/done/achieved · **Single most important change:** {{change}}

### B1. Workload split – from Done child tasks (never the sprint board)
| Team | New Business | Tickets | Revamp | Other | Outside-sprint share |
|---|---|---|---|---|---|

### B2. Utilisation (stated as a floor)
> Hours are a **floor**. `CompletedWork` accumulates over a task's whole life. Never used as a timesheet or to judge an individual.

### B3. Capacity constraints (intake vs throughput)
### B3a. Team size – why it may not be available
Board `AssignedTo` is the lead who moved the item, not the team. No headcount recommendation is made from it.

### B4. Escalations – what the PMO needs, from whom, by when
| # | Escalation | Needed from | Response by |
|---|---|---|---|

### B4a. Status of previous escalations
| # | Escalation | Raised | Age (days) | Status (re-verified) |
|---|---|---|---|---|

### B5. Decisions required
### B5a. Delivery-system sustainability (PMBOK 8)
### B6. Data quality affecting these figures
Name the dimension: completeness · accuracy · consistency · timeliness · validity.

---

## Weekly inputs (data-request pack – issued Thursday)
| Input | Owner | Deadline | Received? |
|---|---|---|---|
| Sprint delivery (ADO MCP, live) | PMO (self-serve) | Friday | |
| Tickets export ("Active All Requests") | TBC | Thursday | |
| Wiki documentation extract | TBC | Thursday | |
| AI consumption export | {{pm}} | Thursday | |
| **Teams chat log** | {{pm}} | Thursday | |
| Status of work not tracked in ADO | TBC | Thursday | |
