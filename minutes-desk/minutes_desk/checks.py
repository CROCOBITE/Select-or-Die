"""Pre-issue checks on a minutes document (Markdown), plus a PM-standard scorecard.

Checks come from the PMO skills: report integrity (KPI-feedback rule, banned constructions,
"baseline" only for an approved plan), RAID discipline (owner · due · status, visible TBC), the
naming rule, and the six PM reporting standards every management document is held to.
"""

import re

from .governance import NAMING

TEAM_WORDS = ("team", "scrum", "department", "dept", "unit", "group", "committee", "everyone", "all",
              "فريق", "قسم", "ادارة", "إدارة", "الكل", "التيم", "الجميع")
BANNED = [
    (re.compile(r"\bwe are (working|looking) on\b|\bin progress\b(?![^|\n]*\d{4}-\d{2}-\d{2})", re.I),
     "Activity without a result or date – write the KPI moved, or the gap with owner and due date"),
    (re.compile(r"\bas soon as possible\b|\bASAP\b|\bsoon\b|في أقرب وقت|قريب", re.I), "Vague timing – give a date"),
    (re.compile(r"\bbaseline\b(?!.{0,40}approved)", re.I), "“Baseline” is only for an approved, change-controlled plan"),
    (re.compile(r"شغالين عليه|بنشتغل عليه"), "Activity without a result or date"),
]
REQUIRED = {
    "Management summary": "status, decisions and actions at a glance",
    "Decisions": "what was decided, by whom, on what basis",
    "Actions": "owner, due date and status for every action",
    "Open issues and root cause": "issue, root cause, corrective and preventive action",
    "To confirm before sending": "one consolidated request pack",
}
BUSINESS = re.compile(r"objective|impact|kpi|revenue|patient|claim|cost|sla|هدف|تأثير|اثر|المرضى|الإيراد|المطالبات", re.I)


def sections(md):
    out, current = {}, None
    for line in md.splitlines():
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m:
            current = m.group(1)
            out[current] = []
        elif current:
            out[current].append(line)
    return {k: "\n".join(v) for k, v in out.items()}


def rows(block):
    lines = [l for l in block.splitlines() if l.strip().startswith("|")]
    if len(lines) < 3:
        return []
    head = [h.strip() for h in lines[0].strip("|").split("|")]
    return [dict(zip(head, (c.strip() for c in l.strip("|").split("|")))) for l in lines[2:]]


def _finding(level, area, text):
    return {"level": level, "area": area, "text": text}


def run(md):
    secs = sections(md)
    findings = []
    findings += _action_findings(rows(secs.get("Actions", "")))
    findings += _decision_findings(rows(secs.get("Decisions", "")))
    findings += _issue_findings(rows(secs.get("Open issues and root cause", "")))
    findings += _text_findings(md)
    for name, why in REQUIRED.items():
        if name not in secs:
            findings.append(_finding("major", "structure", f"Missing section “{name}” – {why}"))
    pending = rows(secs.get("To confirm before sending", ""))
    if pending:
        findings.append(_finding("info", "information", f"{len(pending)} items to confirm – send the request pack before issue"))
    score = max(0, 100 - sum({"blocker": 25, "major": 10, "minor": 3, "info": 0}[f["level"]] for f in findings))
    return {"score": score, "findings": findings, "scorecard": scorecard(md, secs, findings)}


def _action_findings(actions):
    out = []
    for a in actions:
        ref, owner, due = a.get("#", "?"), a.get("Owner", ""), a.get("Due", "")
        if owner.startswith("TBC") or owner in ("", "Not stated"):
            out.append(_finding("major", "actions", f"{ref}: no named owner – assign one person"))
        elif any(w == owner.lower() or owner.lower().startswith(w + " ") for w in TEAM_WORDS):
            out.append(_finding("major", "actions", f"{ref}: owner “{owner}” is a team, not one named person"))
        if not re.search(r"\d{4}-\d{2}-\d{2}", due):
            out.append(_finding("major", "actions", f"{ref}: no due date"))
        elif "said:" in due:
            out.append(_finding("minor", "actions", f"{ref}: due date resolved from a relative phrase – confirm it"))
    return out


def _decision_findings(decisions):
    return [_finding("minor", "decisions", f"{d.get('#', '?')}: decision needs confirming against the recording")
            for d in decisions if d.get("Basis", "").lower().startswith("needs")]


def _issue_findings(issues):
    out = []
    for i in issues:
        if i.get("Root cause", "").startswith("Not established"):
            out.append(_finding("minor", "analysis", f"{i.get('#', '?')}: no root cause – ask “why” before closing"))
        if i.get("Corrective action", "TBC") in ("TBC", "Not stated", ""):
            out.append(_finding("minor", "analysis", f"{i.get('#', '?')}: no corrective action with owner and date"))
    return out


def _text_findings(md):
    body = re.sub(r"## Discussion – as written[\s\S]*?(?=\n## |\n---|\Z)", "", md)
    out = []
    for pattern, why in BANNED:
        for m in pattern.finditer(body):
            out.append(_finding("minor", "wording", f"“{m.group(0)}”: {why}"))
    for pattern, written in NAMING:
        for m in pattern.finditer(body):
            if m.group(0) != written:
                out.append(_finding("minor", "terminology", f"“{m.group(0)}” – write “{written}”"))
    if re.search(r"\|\s*RAG[^|]*\|", md) and re.search(r"\|\s*(High|Medium|Low)\s*\|", md):
        out.append(_finding("minor", "terminology", "A RAG column holds High/Medium/Low – that is priority; keep RAG and priority apart"))
    return out


def scorecard(md, secs, findings):
    """Six PM reporting standards, each Strong / Partial / Weak with the evidence."""
    by_area = lambda *areas: [f for f in findings if f["area"] in areas and f["level"] != "info"]
    acts = rows(secs.get("Actions", ""))
    iss = rows(secs.get("Open issues and root cause", ""))
    missing = [n for n in REQUIRED if n not in secs]
    cards = [
        _card("Organisation and planning", by_area("actions"), len(acts),
              "Every action has one owner, a date and a status"),
        _card("Analysis", by_area("analysis"), len(iss), "Every issue has a root cause and a next action"),
        _business(md, secs),
        _card("Information gathering", [] if "To confirm before sending" in secs else [1], 1,
              "Open questions are consolidated into one request pack, grouped by who answers"),
        _card("Report structure", missing, len(REQUIRED), "Summary, decisions, actions, issues and requests are all present"),
        _card("Terminology", by_area("terminology", "wording"), 1, "House names, RAG vs priority, no vague timing"),
    ]
    return cards


def _card(name, problems, total, standard):
    n = len(problems)
    level = "Strong" if n == 0 else ("Partial" if total and n <= max(1, total // 2) else "Weak")
    return {"standard": name, "level": level, "rule": standard, "open": n}


def _business(md, secs):
    objective = next((r.get("Position", "") for r in rows(secs.get("Management summary", ""))
                      if r.get("Item") == "Business objective"), "")
    linked = bool(objective) and not objective.startswith("Not set") or bool(BUSINESS.search(secs.get("Decisions", "")))
    return {"standard": "Business context", "level": "Strong" if linked else "Partial",
            "rule": "Decisions and issues name the objective or business impact they touch",
            "open": 0 if linked else 1}
