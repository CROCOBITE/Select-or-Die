// Business goal → draft artifact set. Deterministic templates: nothing is invented.
// Every value the PM did not give is written as "not set" or "TBC" so gaps stay visible.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(here, '..', 'templates');

const val = (v, fallback = 'not set') => (v && String(v).trim() ? String(v).trim() : fallback);
const owner = (v) => val(v, 'TBC – requires assignment');
const lines = (v) => String(v || '').split('\n').map((s) => s.trim()).filter(Boolean);
const today = () => new Date().toISOString().slice(0, 10);

const fm = (meta) => `---\n${Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n`;

function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** "Role: capability" or plain capability lines → stories grouped under one epic. */
export function parseCapabilities(text) {
  return lines(text).map((l, i) => {
    const m = /^([^:]{2,40}):\s*(.+)$/.exec(l);
    return { n: i + 1, role: m ? m[1].trim() : 'user', capability: (m ? m[2] : l).trim() };
  });
}

function charter(i) {
  const objectives = lines(i.objectives);
  const inScope = lines(i.inScope);
  const outScope = lines(i.outScope);
  const stakeholders = lines(i.stakeholders);
  const risks = lines(i.risks);
  return `${fm({ id: 'CHARTER', title: `Project Charter – ${i.name}`, type: 'charter', gate: 'G1', owner: owner(i.pm), status: 'Draft v1 – generated, awaiting review' })}# Project Charter – ${i.name}

| Document control | |
|---|---|
| Version | 1.0 (generated draft) |
| Issue date | ${today()} |
| Prepared by | ${owner(i.pm)} |
| Delivery approach | ${val(i.approach, 'Hybrid – stage gates + Scrum sprints')} |
| Tailoring | Domains with no input are marked "not set"; see section 9 for the decisions needed to complete them. |

## 1. Purpose
${val(i.goal)}

## 2. The problem today
${val(i.problem)}

## 3. What will be different – objectives
| ID | Objective | Measure | Target |
|---|---|---|---|
${(objectives.length ? objectives : ['not set']).map((o, n) => {
    const [obj, measure, target] = o.split('|').map((s) => s.trim());
    return `| OBJ-${String(n + 1).padStart(2, '0')} | ${obj} | ${val(measure)} | ${val(target)} |`;
  }).join('\n')}

## 4. Scope
**In scope**
${(inScope.length ? inScope : ['not set']).map((s) => `- ${s}`).join('\n')}

**Out of scope**
${(outScope.length ? outScope : ['not set']).map((s) => `- ${s}`).join('\n')}

## 5. How it works
${val(i.howItWorks, 'not set – add a simple flow once the solution approach is agreed.')}

## 6. Timeline – milestones
| Milestone | Date | Status |
|---|---|---|
| Charter sign-off (Gate 1) | ${val(i.startDate)} | Proposed |
| Go-live | ${val(i.goLive)} | Proposed |

All dates are **proposed** until the accountable owner confirms capacity.

## 7. Who is involved
| Role | Name | Responsibility |
|---|---|---|
| Project Manager | ${owner(i.pm)} | Charter, plan, RAID, reporting |
| Sponsor | ${owner(i.sponsor)} | Funding, final escalation |
| Business Owner | ${owner(i.businessOwner)} | Process, acceptance, adoption |
${stakeholders.map((s) => `| Stakeholder | ${s} | |`).join('\n')}

## 8. Risks and dependencies
| ID | Risk | RAG | Owner |
|---|---|---|---|
${(risks.length ? risks : ['not set']).map((r, n) => `| R-${String(n + 1).padStart(2, '0')} | ${r} | Medium | TBC – requires assignment |`).join('\n')}

## 9. Decisions needed
| # | Decision | Recommendation | From | Needed by |
|---|---|---|---|---|
| 1 | Name the Sponsor | – | Management | ${val(i.startDate)} |
| 2 | Confirm objective baselines and targets | Capture a pilot baseline first | Business Owner | Gate 2 |
`;
}

function stories(i) {
  const caps = parseCapabilities(i.capabilities);
  const medical = /medical/i.test(i.teamType || '');
  return `${fm({ id: 'STORIES', title: 'User Stories – Release 1 Backlog', type: 'stories', gate: 'G2', owner: owner(i.pm), status: 'Draft v1 – generated skeletons, refine with the PO', team_type: medical ? 'medical' : 'non-medical' })}# User Stories – ${i.name}

Generated skeletons. Priorities, sources and acceptance criteria **must be refined with the Product Owner** before Definition of Ready.

## EP-01 · ${i.name}

${caps
  .map(
    (c) => `### FE-01.${c.n} · ${c.capability}

#### US-${String(c.n).padStart(3, '0')} · ${c.capability}
- **Story:** As a ${c.role}, I want ${c.capability.charAt(0).toLowerCase() + c.capability.slice(1)}, so that ${val(i.goal, 'the business goal is met').replace(/\.$/, '').toLowerCase()}.
- **Priority:** not set · **Phase:** not set · **Team:** not set
- **Source:** not set
- **Acceptance criteria:**
  1. Given a ${c.role}, when they use "${c.capability}", then the expected result is recorded _(refine)_.
  2. Given valid input, when the action completes, then the outcome is saved with an audit entry _(refine)_.
  3. **Failure:** Given the source system is unavailable, when the ${c.role} tries the action, then a clear error is shown and no data is lost _(refine)_.
- **Dependencies / assumptions:** not set
${medical ? '- **Clinical owner:** not set\n- **Privacy:** not set\n' : '- **Business owner / approval step:** not set\n'}- **Estimate:** _(team)_
- **Open questions:** Refine with the Product Owner.
`
  )
  .join('\n')}`;
}

function plan(i) {
  return `${fm({ id: 'PLAN', title: 'Project Plan – WBS & Schedule', type: 'plan', gate: 'G2', owner: owner(i.pm), status: 'Draft v1 – generated' })}# Project Plan – ${i.name}

## 1. Stage gates
| Gate | Name | Exit criteria | Approver |
|---|---|---|---|
| G0 | Discovery | Sources read, gaps declared | ${owner(i.pm)} |
| G1 | Initiation | Charter signed, sponsor named | ${owner(i.sponsor)} |
| G2 | Planning | Stories pass INVEST/DoR; WBS and RAID baselined | Steering committee – TBC |
| G3 | Build | Sprint goals met; test entry criteria met | ${owner(i.pm)} |
| G4 | Quality | UAT passed; security review passed | ${owner(i.businessOwner)} |
| G5 | Transition | Go / no-go; hypercare closed; rollback plan tested | Steering committee – TBC |

## 2. Work Breakdown Structure
| WBS | Work package | Deliverable | Responsible |
|---|---|---|---|
| 1 | Project management | Charter, RAID, weekly reports | ${owner(i.pm)} |
${parseCapabilities(i.capabilities).map((c) => `| ${c.n + 1} | ${c.capability} | US-${String(c.n).padStart(3, '0')} | not set |`).join('\n')}
| T | Testing | SIT, UAT (acceptance) | not set |
| R | Transition | Go-live, hypercare, rollback plan | not set |

## 3. Schedule
| Milestone | Start | Finish | Status |
|---|---|---|---|
| Gate 1 | ${val(i.startDate)} | ${val(i.startDate)} | Proposed |
| Go-live | – | ${val(i.goLive)} | Proposed |

**Critical path:** not set – derive once dependencies are known.
**Forecast:** not set – requires team estimates. State the assumption and what would break it.
`;
}

function raid(i) {
  const risks = lines(i.risks);
  return `${fm({ id: 'RAID', title: 'RAID Log', type: 'raid', gate: 'G2', owner: owner(i.pm), status: `Baseline v1 – ${today()}` })}# RAID Log – ${i.name}

## Risks (not yet happened)
| ID | Risk | Probability | Impact | RAG | Owner | Mitigation | Status | Source |
|---|---|---|---|---|---|---|---|---|
${(risks.length ? risks : ['not set']).map((r, n) => `| R-${String(n + 1).padStart(2, '0')} | ${r} | Medium | Medium | Medium | TBC – requires assignment | not set | Open | PM input ${today()} |`).join('\n')}

## Issues (already happening)
| ID | Issue | Impact | RAG | Owner | Action required | Raised | Age (days) | Status | Source |
|---|---|---|---|---|---|---|---|---|---|

## Assumptions (treated as true, not confirmed)
| ID | Assumption | Who confirms | Consequence if wrong | Validation status | Source |
|---|---|---|---|---|---|

## Dependencies
| ID | Waiting party | Depends on | Direction | Required by | Owner | Status | Source |
|---|---|---|---|---|---|---|---|

## Actions (management reads this sheet)
| ID | Action | Owner | Due date | RAG | Status | Decision required from |
|---|---|---|---|---|---|---|
| AC-01 | Name the Sponsor | ${owner(i.pm)} | ${val(i.startDate)} | High | Open | Management |
`;
}

export function generateArtifacts(input) {
  const i = { ...input, name: val(input.name, 'Untitled project') };
  const vars = {
    project: i.name,
    pm: owner(i.pm),
    approver: owner(i.approver),
    approach: val(i.approach, 'Hybrid – stage gates + Scrum sprints'),
    sites: val(i.sites, 'sites not set'),
    team_rows: lines(i.teams).map((t) => `| ${t} | | |`).join('\n'),
  };
  const tpl = (f) => fill(fs.readFileSync(path.join(TEMPLATES, f), 'utf8'), vars);
  return [
    { key: 'CHARTER', title: `Project Charter – ${i.name}`, type: 'charter', gate: 'G1', content: charter(i) },
    { key: 'STORIES', title: 'User Stories – Release 1 Backlog', type: 'stories', gate: 'G2', content: stories(i) },
    { key: 'PLAN', title: 'Project Plan – WBS & Schedule', type: 'plan', gate: 'G2', content: plan(i) },
    { key: 'RAID', title: 'RAID Log', type: 'raid', gate: 'G2', content: raid(i) },
    { key: 'WEEKLY', title: 'PMO Weekly Report Template', type: 'weekly', gate: 'G5', content: tpl('06-weekly-report-template.md') },
    { key: 'RELNOTES', title: 'Release Notes & Week Conclusion', type: 'release-notes', gate: 'G5', content: tpl('07-release-notes-template.md') },
  ];
}
