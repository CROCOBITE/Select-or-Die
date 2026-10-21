// Skill registry: what each skill gives the PM, where it stops, and where Phase Zero applies it.
// IDs are neutral; workspace/config.json "skillAliases" maps them to the folder names of the
// organisation's own skill texts (used by live reviews).

export const SKILLS = [
  {
    id: 'pmo-report-integrity',
    name: 'PMO report integrity',
    purpose: 'Measurement rules and pre-issue checks for every report and dashboard.',
    benefits: [
      'Every leadership line is a KPI moved (was → now, dated) or a gap (today, target, due, named person).',
      'One binding definition per metric, so four reports stop giving four answers.',
      'Separates "not done" from "done, not evidenced" (opposite fixes).',
      'Five-block diagnostic standard: finding, evidence, root cause, corrective, preventive.',
      'Ticket-export traps handled: flagged status values, export date vs period end, unstatused rows as a range.',
    ],
    boundaries: [
      'Rules are text and table heuristics: they catch the shape of a bad line, not whether a figure is true.',
      '"Baseline" is reserved for an approved, change-controlled plan; proposed dates are reference dates.',
      'The 5-point rule needs at least three cycles of completion data per team.',
      'Binding definitions need the source exports; Phase Zero does not pull ticketing or HR data itself.',
    ],
    coded: ['Reviewer "Report integrity" on charter, plan, RAID, weekly, release notes, KPI reply, executive page, minutes', 'Reviewer "Diagnostic standard" on RAID and weekly report', 'Ticket export analyser (triage rate, open by group, unstatused range, OK/MISMATCH checks)', 'fivePointRule() and normaliseStatus() helpers'],
  },
  {
    id: 'leadership-kpi-reply',
    name: 'Leadership KPI reply',
    purpose: 'Replies to leadership in the two-table shape: A = KPIs moved, B = gaps with target, due date and owner.',
    benefits: ['The only reply shape that has landed with leadership.', 'Owners are named people and due dates are dates, so the reply can be scored next month.', 'Asks sit in their own "What I need" block with decider and date.'],
    boundaries: ['A proposal is not a status reply; label it as one.', 'The tool cannot judge whether a number is the "inconvenient" one; it reminds you to find it.', 'Owner check is a heuristic (two words, not a team or role).'],
    coded: ['New artifact type "kpi-reply" with template', 'Reviewer "KPI reply shape" (Table A/B rules, close-with-nothing, banned constructions)'],
  },
  {
    id: 'exec-team-deliverable',
    name: 'Executive per-team page',
    purpose: 'One panel per team for the CEO: business headline, mechanism diagram, 3–5 outcomes, four-number strip, flag only if needed.',
    benefits: ['Leadership reads what changed for the business without the backlog.', 'The mechanism diagram shows the before-state and what changed.', 'Low completion figures carry their business cause in the same breath.'],
    boundaries: ['Built from the weekly delivery facts; it does not create them.', 'Translating engineering work into business outcome is still the PM\'s writing; the reviewer only blocks engineering vocabulary.', 'Uses the document palette (navy/orange), not the application palette.'],
    coded: ['New artifact type "executive" with template', 'HTML export with one inline SVG mechanism per team', 'Reviewer "Executive page" (vocabulary ban, structure)'],
  },
  {
    id: 'ticket-review-minutes',
    name: 'Ticket review & meeting minutes',
    purpose: 'Turns a QA / team thread or rough notes into minutes, decisions, actions, conflicts and Root cause / Solution / Deadline blocks.',
    benefits: ['Keeps the author\'s own wording ("Discussion – as written").', 'PMO judgement kept apart from team decisions.', 'QA-vs-team disagreements flagged as CONFLICT.', 'Naming rule: "DevOps" and "Tickets System", never acronyms.'],
    boundaries: ['Extraction is pattern-based; every decision and action is confirmed by the PM.', 'Writing to DevOps stays behind the approval phrase in Phase Zero, even where a skill pre-authorises writes.', 'Naming rule applies to ticket-review deliverables only.'],
    coded: ['Minutes builder (Teams view → "Meeting minutes")', 'Reviewer "Ticket-review naming" on minutes'],
  },
  {
    id: 'pmo-raid-log',
    name: 'PMO RAID log',
    purpose: 'RAID is the source; any finding becomes an owner, a date and a decision.',
    benefits: ['Actions carry Owner · Due · RAG · Status · Decision required from.', 'TBC owners stay visible.', 'Assumptions need a consequence-if-wrong.', 'Data-quality problems named by dimension.'],
    boundaries: ['Dashboard counts come from the markdown registers; the xlsx export is not formula-driven.', 'Risk → issue moves are by editing; history is kept by version control, not a register link.'],
    coded: ['Reviewer "RAID discipline" (extended: decision-required column, data-quality dimension, escalation response-by)', 'Dashboard computed from RAID', 'Findings table (diagnostic standard) in RAID templates'],
  },
  {
    id: 'pmo-weekly-report',
    name: 'PMO weekly report',
    purpose: 'Two documents by audience plus a dashboard; verdict first, evidence behind.',
    benefits: ['Locked A0–A11 / B0–B6 structure; missing inputs show as "Not supplied".', 'Dashboard order: decisions, actions due in 7 days, indicators, then charts.', 'Classification mapping kept consistent.'],
    boundaries: ['Phase Zero holds the template and checks; live sprint figures still come from the DevOps pull.', 'Its "wiki is empty" note is outdated (the wiki git repository holds pages; only the listing API returns none).', 'Its non-medical group includes DevOps and IT operations teams, which the integrity skill forbids; the integrity rule wins.'],
    coded: ['Weekly template', 'Reviewer "Weekly report structure" (extended: document control fields)', 'Dashboard ordering'],
  },
  {
    id: 'devops-extraction',
    name: 'DevOps extraction',
    purpose: 'How to pull and verify DevOps data: WIQL, field map, traps, carryover and utilisation rules.',
    benefits: ['Avoids silent undercounts (link-query cap, mangled ID lists, partial globs).', 'Workload split from Done child tasks, not the board.', 'Dependency reconstruction labelled as inference.'],
    boundaries: ['Phase Zero does not query DevOps; Claude does, through the DevOps connector.', 'Its wiki trap (#9) is outdated: read pages through the wiki git repository.'],
    coded: ['ADO publish manifest checks: no new tags (tag creation is permission-blocked), area path without trailing separator, title prefixes for category'],
  },
  {
    id: 'user-stories-and-charter',
    name: 'User stories & charter',
    purpose: 'Stories with Given/When/Then criteria and a short non-technical charter, from a BRD or analysis.',
    benefits: ['Every story traces to a source section.', 'Medical extras: clinical owner, read-only data, safety criterion.', 'Never invents dates, owners or estimates.'],
    boundaries: ['Estimates stay blank until the team estimates.', 'Priority comes from the source; the generator writes "not set".'],
    coded: ['Generator (charter + stories)', 'Reviewers "INVEST + Definition of Ready" and "Charter completeness"'],
  },
  {
    id: 'app-design-system',
    name: 'Application design system',
    purpose: 'The product look for web tools and dashboards: teal-and-mint palette, glass surfaces, squircle shells, light and dark.',
    benefits: ['Phase Zero looks like it belongs to the Project Hub product.', 'Three-block theme tokens with a sun/moon toggle.', 'Full semantic colours for application status.'],
    boundaries: ['Application UI only. Word/Excel reports and leadership pages keep the document palette (navy/orange, no green).', 'Never mix the two palettes in one deliverable.'],
    coded: ['Phase Zero UI tokens and theme toggle', 'Exports keep the document palette'],
  },
];

export const skillById = (id) => SKILLS.find((s) => s.id === id);
