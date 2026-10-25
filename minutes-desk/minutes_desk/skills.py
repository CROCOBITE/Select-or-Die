"""Which skills Minutes Desk is harnessed with: what each gives, where it stops, where it is coded."""

from pathlib import Path

SKILLS = [
    {"id": "meeting-minutes-from-recordings", "name": "Meeting minutes from recordings",
     "benefits": ["Audio, video, Teams transcripts, WhatsApp exports and notes all end in the same minutes spine",
                  "Dialect-aware models for Egyptian and Gulf Arabic, chosen for the machine it runs on",
                  "Every line cites its source time, so a reader can check it against the recording"],
     "boundaries": ["A machine transcript is evidence of what was said, not of what was done",
                    "Speaker names come from Teams/WhatsApp; audio alone has no reliable speaker labels",
                    "Accuracy must be measured on your own audio (pilot WER) before a model is trusted"],
     "coded": ["engines.py, importers.py, templates.py", "Pilot WER/CER tool", "Transcript flags"]},
    {"id": "ticket-review-minutes", "name": "Ticket review & meeting minutes",
     "benefits": ["Tickets discussed table with outcome, owner and due date", "Conflicts recorded on both sides",
                  "PMO judgement kept apart; the speaker's own wording kept under “Discussion – as written”"],
     "boundaries": ["Writing to DevOps stays outside the tool: it produces a “MOM:” line to paste, never a write"],
     "coded": ["Ticket template", "Conflict detection", "Naming rule DevOps / Tickets System"]},
    {"id": "pmo-report-integrity", "name": "PMO report integrity",
     "benefits": ["KPI-feedback rule and banned constructions checked before issue",
                  "“Baseline” only for an approved plan", "Numbers flagged for confirmation"],
     "boundaries": ["Checks the shape of a line, not whether a figure is true"],
     "coded": ["checks.py", "verify-number flag"]},
    {"id": "pmo-raid-log", "name": "PMO RAID log",
     "benefits": ["Actions carry one owner, a date and a status; TBC owners stay visible",
                  "Issues carry root cause, corrective and preventive action"],
     "boundaries": ["The tool does not keep the RAID register itself; export the actions into it"],
     "coded": ["Actions and issues tables", "Action findings"]},
    {"id": "leadership-kpi-reply", "name": "Leadership KPI reply",
     "benefits": ["Steering template uses Table A (was → now) and Table B (today, target, due, owner)"],
     "boundaries": ["Was/now figures must come from the data, not from the meeting audio"],
     "coded": ["Steering template"]},
    {"id": "eliciting-business-needs", "name": "Eliciting business needs",
     "benefits": ["Every issue asks “why” – root cause or “not established”", "Business objective line on every set of minutes"],
     "boundaries": ["The 5-whys chain is the PM's follow-up; the tool only marks where it is missing"],
     "coded": ["Root-cause column", "Business context scorecard"]},
    {"id": "structuring-requirements", "name": "Structuring requirements",
     "benefits": ["Needs voiced in a meeting become draft stories (As a / I want / so that) with role and value TBC"],
     "boundaries": ["Draft stories are not backlog items; they go through the PRD and DoR first",
                    "The skill's “create in DevOps” step is overridden: no writes without the written approval phrase"],
     "coded": ["Requirements and scope section"]},
    {"id": "validating-project-scope", "name": "Validating project scope",
     "benefits": ["New requests in a meeting are flagged as scope changes needing a change request"],
     "boundaries": ["The skill's “comment on the DevOps item” step is overridden: the tool never writes to DevOps"],
     "coded": ["Scope-change detection"]},
    {"id": "evaluating-solution-value", "name": "Evaluating solution value",
     "benefits": ["Decisions are tied to the objective or business impact they serve"],
     "boundaries": ["The tool cannot measure ROI; it asks for the objective"],
     "coded": ["Business objective field and check"]},
    {"id": "conducting-market-research", "name": "Conducting market research",
     "benefits": ["Open-source engines compared on licence, dialect coverage and hardware before adoption"],
     "boundaries": ["Published WER figures are claims until the pilot on your own audio confirms them"],
     "coded": ["Model catalogue with licences (config.py)", "README tool comparison"]},
    {"id": "frontend-design-review", "name": "Frontend design & review",
     "benefits": ["Core task in three steps (add file → transcribe → minutes)", "Light/dark themes, keyboard focus, RTL text"],
     "boundaries": ["No design-system library; tokens are local to the page"],
     "coded": ["web/index.html, app.js, styles.css"]},
    {"id": "refactor-method-complexity-reduce", "name": "Method complexity",
     "benefits": ["Small single-purpose functions; a test fails when one grows past the limit"],
     "boundaries": ["The limit is a guide, not proof of good design"],
     "coded": ["tests/test_quality.py"]},
    {"id": "devops-rollout-plan", "name": "Rollout plan",
     "benefits": ["Pilot → limited → full rollout on the desk, with the WER gate between pilot and use"],
     "boundaries": ["A desk tool, not a server deployment"],
     "coded": ["README “Rollout”"]},
    {"id": "skill-creator", "name": "Skill creator",
     "benefits": ["The new minutes skill is written in the standard SKILL.md format"],
     "boundaries": ["The skill file is uploaded by you; the tool does not install skills"],
     "coded": ["Private skill file in the workspace"]},
]

NOT_APPLIED = {
    "angular-component": "Angular – the tool has no Angular front end",
    "angular-new-app": "Angular – not used", "angular-reactivity": "Angular – not used",
    "angular-security-perf": "Angular – not used",
    "dotnet-best-practices": ".NET – the tool is Python", "dotnet-design-pattern-review": ".NET – not used",
    "dotnet-upgrade": ".NET – not used", "temporal-developer": "Temporal workflows – not used",
    "estimating-use-cases": "Use-case points – no estimate requested for this tool",
    "refactor": "Covered by method-complexity", "refactor-plan": "No legacy code to plan a refactor for",
    "frontend-design": "Covered by frontend-design-review",
}


def listing(cfg):
    base = Path(cfg.get("skills_dir") or "")
    aliases = cfg.get("skill_aliases", {})
    out = []
    for s in SKILLS:
        folder = aliases.get(s["id"], s["id"])
        out.append(dict(s, text_available=(base / folder / "SKILL.md").is_file() if cfg.get("skills_dir") else False))
    return {"applied": out, "not_applied": NOT_APPLIED}
