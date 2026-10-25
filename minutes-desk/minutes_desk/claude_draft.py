"""Optional Claude draft of the minutes. Runs only after the person has seen the exact, redacted
payload in a preview and confirmed it; the preview's sha must match what is sent.
"""

import hashlib
import json
from pathlib import Path

from .extract import stamp
from .governance import redact
from .templates import TEMPLATES

INSTRUCTIONS = """You write meeting minutes for a PMO from a transcript. The transcript may be Egyptian,
Gulf/Saudi or Modern Standard Arabic mixed with English; it may contain recognition errors.

Write the minutes in English unless the person asks otherwise. Quote Arabic only where the exact
wording matters, and give an English rendering next to it.

Rules – follow every one:
- Use exactly the section headings and table columns of the skeleton you are given, in that order.
- Never invent an owner, a date, a number or a decision. Write "TBC – requires assignment",
  "Date not stated" or "Not stated". A relative date ("بكرة", "next week") may be resolved against
  the meeting date, but write what was said in brackets after it.
- Every decision, action, issue and conflict cites its source reference from the transcript,
  e.g. `12:40` or `2026-10-03 13:59`.
- An action has one named person as owner, never a team.
- Every issue gets a root cause if one was stated, otherwise "Not established in the meeting",
  plus a corrective and a preventive action when they were stated.
- Where two parties disagree, record both and do not choose.
- Leadership lines are either a KPI that moved (was -> now, dated) or a gap (today, target, due,
  one named owner). No "we are working on", no "in progress" without a date, no "ASAP".
- Use "baseline" only for an approved, change-controlled plan.
- Write "DevOps" for Azure DevOps/ADO/TFS and "Tickets System" for the ticketing/CRM system.
- Keep PMO judgement apart from what the meeting agreed, under its own heading.
- Put every open question into the "To confirm before sending" table, grouped by the person who
  must answer, so it can be sent once as one request.
- Segments marked FLAG may be misrecognised: do not rely on them for a decision without saying so.
- Output Markdown only, starting with the "# " title line."""


def skill_texts(cfg):
    base = Path(cfg.get("skills_dir") or "")
    out = []
    for name in cfg.get("skills_for_minutes", []):
        path = base / name / "SKILL.md"
        if path.is_file():
            out.append(f"<skill name=\"{name}\">\n{path.read_text(encoding='utf-8')[:12000]}\n</skill>")
    return out


def transcript_lines(transcript):
    lines = []
    for seg in transcript.get("segments", []):
        flag = " FLAG" if any(f["code"] != "verify-number" for f in seg.get("flags", [])) else ""
        who = f"{seg['speaker']}: " if seg.get("speaker") else ""
        lines.append(f"[{stamp(seg)}{flag}] {who}{seg.get('text', '')}")
    return "\n".join(lines)


def build_payload(meta, transcript, skeleton, template, cfg):
    system = INSTRUCTIONS + "\n\n" + "\n\n".join(skill_texts(cfg))
    meta_view = {k: meta.get(k) for k in ("title", "date", "audience", "chair", "attendees", "objective",
                                          "distribution", "validator", "author")}
    raw = (f"Template: {TEMPLATES.get(template, template)}\n\nMeeting details:\n"
           f"{json.dumps(meta_view, ensure_ascii=False, indent=1)}\n\n"
           f"Skeleton produced offline (keep its headings and columns; improve and complete the content):\n"
           f"<skeleton>\n{skeleton}\n</skeleton>\n\nTranscript:\n<transcript>\n{transcript_lines(transcript)}\n</transcript>")
    user, counts = redact(raw)
    sha = hashlib.sha256((system + "\n" + user).encode("utf-8")).hexdigest()
    return {"system": system, "user": user, "redactions": counts, "sha": sha,
            "model": cfg["claude"]["model"], "approx_tokens": (len(system) + len(user)) // 3}


def draft(payload, cfg):
    import anthropic

    client = anthropic.Anthropic()
    with client.beta.messages.stream(
        model=cfg["claude"]["model"],
        max_tokens=int(cfg["claude"]["max_tokens"]),
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        thinking={"type": "adaptive"},
        output_config={"effort": cfg["claude"]["effort"]},
        system=[{"type": "text", "text": payload["system"], "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": payload["user"]}],
    ) as stream:
        message = stream.get_final_message()
    if message.stop_reason == "refusal":
        raise RuntimeError("Claude declined this request; the offline draft is unchanged")
    text = "".join(block.text for block in message.content if block.type == "text").strip()
    if message.stop_reason == "max_tokens":
        text += "\n\n_The draft stopped at the length limit – review the last section._"
    return {"markdown": text, "model": message.model, "stop_reason": message.stop_reason,
            "usage": {"input": message.usage.input_tokens, "output": message.usage.output_tokens}}
