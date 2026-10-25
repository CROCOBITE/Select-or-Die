"""Local HTTP server (standard library). Binds to 127.0.0.1, refuses foreign Host headers
(DNS rebinding) and requires the X-Minutes-Desk header on every write (cross-site requests
cannot set it)."""

import json
import mimetypes
import re
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from . import checks, claude_draft, config, docx, engines, extract, governance, importers, media, skills, templates
from .store import Store

WEB = config.ROOT / "web"
JSON_LIMIT = 20 * 1024 * 1024
TRANSCRIPT_SUFFIXES = {".vtt", ".srt", ".txt", ".md", ".docx"}
JOBS = {}


class Api:
    def __init__(self, cfg, store):
        self.cfg, self.store = cfg, store

    # ------------------------------------------------------------------ helpers
    def people(self):
        return self.cfg.get("people", [])

    def transcript(self, mid, v=None):
        t = self.store.version(mid, "transcript", v) if v else self.store.latest(mid, "transcript")
        if not t:
            raise KeyError("No transcript yet – add a recording or a transcript file first")
        return t

    def offline(self, mid, template):
        meta = self.store.get(mid)
        meta.update(self._audience_defaults(meta))
        t = in_period(self.transcript(mid), meta.get("period_from"), meta.get("period_to"))
        found = extract.extract(t["segments"], extract.parse_day(meta.get("date")), self.people())
        if t.get("kind") == "whatsapp":
            found["actions"] = [a for a in found["actions"] if not a["owner"].startswith("TBC") or a.get("due")]
        md = templates.build(template, dict(meta, area=self.cfg["area"], author=meta.get("author") or self.cfg["author"]),
                             t, found, self.cfg.get("naming"))
        return md, found, meta, t

    def _audience_defaults(self, meta):
        aud = self.cfg.get("audiences", {}).get(meta.get("audience") or "", {})
        return {k: meta.get(k) or aud.get(k) for k in ("chair", "validator", "distribution", "classification")
                if meta.get(k) or aud.get(k)}

    # ------------------------------------------------------------------ jobs
    def start_transcription(self, mid, engine, model, by, speed=1, pace=1, language=""):
        names = self.store.get(mid)["media"]
        if not names:
            raise ValueError("No recording uploaded for this meeting")
        path = self.store.media_path(mid, names[0])
        job_id = uuid.uuid4().hex[:10]
        JOBS[job_id] = {"id": job_id, "meeting": mid, "status": "running", "progress": 0, "message": "Starting"}
        threading.Thread(target=self._run_job, args=(job_id, mid, path, engine, model, by, speed, pace, language), daemon=True).start()
        self.store.update_meta(mid, {"status": "transcribing"}, by)
        return JOBS[job_id]

    def _run_job(self, job_id, mid, path, engine, model, by, speed=1, pace=1, language=""):
        job = JOBS[job_id]

        def progress(pct, msg):
            job.update(progress=pct, message=msg)
        try:
            result = engines.transcribe(path, self.cfg, engine, model, progress, speed, pace, language)
            result["segments"] = governance.flag_transcript(result["segments"])
            result["source_file"] = path.name
            entry = self.store.save_version(mid, "transcript", result, by, f"Transcribed with {result['model']}")
            self.store.update_meta(mid, {"status": "transcribed"}, by)
            if self.cfg["delete_media_after_transcript"]:
                self.store.delete_media(mid, by, "deleted after transcription (retention setting)")
            job.update(status="done", progress=100, message=f"Transcript v{entry['v']} saved", hint=result.get("speed_hint", ""))
        except Exception as exc:  # pz-ignore: report any engine failure to the person
            job.update(status="failed", message=str(exc)[:500])
            self.store.update_meta(mid, {"status": "failed"}, by)
            self.store.audit("transcribe-failed", by, mid, str(exc)[:300])

    # ------------------------------------------------------------------ uploads
    def upload(self, mid, filename, stream, length, by):
        suffix = Path(filename).suffix.lower()
        limit = int(self.cfg["max_upload_mb"]) * 1024 * 1024
        if suffix in TRANSCRIPT_SUFFIXES:
            if length > JSON_LIMIT:
                raise ValueError("Transcript files are limited to 20 MB")
            parsed = importers.parse(filename, stream.read(length))
            if not parsed["segments"]:
                raise ValueError("No text found in that file")
            t = {"language": self.cfg["language"], "kind": parsed["kind"], "engine": "import",
                 "segments": governance.flag_transcript(parsed["segments"]), "source_file": Path(filename).name}
            entry = self.store.save_version(mid, "transcript", t, by, f"Imported {parsed['kind']} {Path(filename).name}")
            self.store.update_meta(mid, {"status": "transcribed"}, by)
            return {"kind": "transcript", "version": entry, "segments": len(t["segments"])}
        if suffix not in media.MEDIA_SUFFIXES:
            raise ValueError(f"{suffix or 'This file type'} is not supported – use audio, video, .vtt, .srt, .docx or .txt")
        target = self.store.save_media(mid, filename, stream, length, limit)
        self.store.audit("upload-media", by, mid, target.name)
        return {"kind": "media", "file": target.name, "probe": media.probe(target)}

    # ------------------------------------------------------------------ claude
    def claude_preview(self, mid, template):
        md, _found, meta, t = self.offline(mid, template)
        return claude_draft.build_payload(meta, t, md, template, self.cfg)

    def claude_draft(self, mid, template, sha, confirm, by):
        if confirm is not True:
            raise PermissionError("A Claude draft needs an explicit confirmation")
        payload = self.claude_preview(mid, template)
        if payload["sha"] != sha:
            raise PermissionError("The content changed since the preview – preview again before sending")
        self.store.audit("claude-send", by, mid, f"{payload['sha'][:12]} {payload['redactions']}")
        result = claude_draft.draft(payload, self.cfg)
        md = governance.apply_naming(result["markdown"], self.cfg.get("naming"))
        entry = self.store.save_version(mid, "minutes", md, by, f"Claude draft ({result['model']})")
        return {"version": entry, "markdown": md, "checks": checks.run(md), "usage": result["usage"]}

    # ------------------------------------------------------------------ exports
    def export(self, mid, fmt, v=None):
        md = self.store.version(mid, "minutes", v) if v else self.store.latest(mid, "minutes")
        if md is None:
            raise KeyError("No minutes saved yet")
        meta = self.store.get(mid)
        name = re.sub(r"[^\w\-]+", "_", f"Minutes_{meta.get('title') or mid}_{meta.get('date') or ''}").strip("_")
        if fmt == "docx":
            data = docx.build(md, meta.get("title") or "Minutes", meta.get("classification") or "Internal",
                              f"{self.cfg['area']} · {meta.get('title') or ''}")
            return data, name + ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        if fmt == "txt":
            return plain_text(md).encode("utf-8"), name + ".txt", "text/plain; charset=utf-8"
        if fmt == "mom":
            return mom_line(md).encode("utf-8"), name + "_MOM.txt", "text/plain; charset=utf-8"
        return md.encode("utf-8"), name + ".md", "text/markdown; charset=utf-8"


def in_period(transcript, start, end):
    """Chat transcripts can span weeks; keep only the reporting period when one is set."""
    if not (start or end) or transcript.get("kind") != "whatsapp":
        return transcript
    end = (end or "9999") + "T23:59"
    segs = [x for x in transcript["segments"] if (start or "") <= (x.get("at") or "") <= end]
    return dict(transcript, segments=segs)


def plain_text(md):
    """Decisions and actions only, for a Teams or e-mail post."""
    secs = checks.sections(md)
    title = next((l[2:] for l in md.splitlines() if l.startswith("# ")), "Minutes")
    out = [title, ""]
    for name in ("Decisions", "Actions"):
        out.append(name.upper())
        for r in checks.rows(secs.get(name, "")):
            if name == "Decisions":
                out.append(f"{r.get('#')}. {r.get('Decision')} – {r.get('Owner')}")
            else:
                out.append(f"{r.get('#')}. {r.get('Action')} – {r.get('Owner')} – due {r.get('Due')}")
        out.append("")
    return "\n".join(out)


def mom_line(md):
    """One 'MOM:' line for the description of a DevOps meeting task (pasted by hand)."""
    secs = checks.sections(md)
    dec = "; ".join(r.get("Decision", "") for r in checks.rows(secs.get("Decisions", "")))[:400]
    act = "; ".join(f"{r.get('Action', '')} ({r.get('Owner', '')}, {r.get('Due', '')})"
                    for r in checks.rows(secs.get("Actions", "")))[:600]
    return f"MOM: Decisions – {dec or 'none'}. Actions – {act or 'none'}."


# ---------------------------------------------------------------------- HTTP layer

def make_handler(api, allowed_hosts):
    routes = _routes(api)

    class Handler(BaseHTTPRequestHandler):
        server_version = "MinutesDesk"

        def log_message(self, *args):
            return

        def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
            data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "no-store")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(data)

        def _guard(self, write):
            host = (self.headers.get("Host") or "").lower()
            if host not in allowed_hosts:
                self._send(421, {"error": "Requests must come from this computer"})
                return False
            if write and self.headers.get("X-Minutes-Desk") != "1":
                self._send(403, {"error": "Missing X-Minutes-Desk header"})
                return False
            return True

        def _json(self):
            length = int(self.headers.get("Content-Length") or 0)
            if length > JSON_LIMIT:
                raise ValueError("Request is too large")
            return json.loads(self.rfile.read(length) or b"{}")

        def do_GET(self):
            self._dispatch("GET")

        def do_POST(self):
            self._dispatch("POST")

        def _dispatch(self, method):
            if not self._guard(method != "GET"):
                return
            url = urlparse(self.path)
            query = {k: v[0] for k, v in parse_qs(url.query).items()}
            try:
                for m, pattern, fn in routes:
                    match = pattern.fullmatch(url.path)
                    if m == method and match:
                        return fn(self, query, *[unquote(g) for g in match.groups()])
                if method == "GET":
                    return self._static(url.path)
                self._send(404, {"error": "Not found"})
            except KeyError as exc:
                self._send(404, {"error": str(exc).strip("'")})
            except PermissionError as exc:
                self._send(403, {"error": str(exc)})
            except (ValueError, RuntimeError) as exc:
                self._send(400, {"error": str(exc)})

        def _static(self, path):
            rel = "index.html" if path in ("/", "") else path.lstrip("/")
            target = (WEB / rel).resolve()
            if WEB.resolve() not in target.parents or not target.is_file():
                return self._send(404, {"error": "Not found"})
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype.endswith("javascript"):
                ctype += "; charset=utf-8"
            csp = {"Content-Security-Policy": "default-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; "
                                              "font-src https://fonts.gstatic.com; media-src 'self' blob:; img-src 'self' data:"}
            self._send(200, target.read_bytes(), ctype, csp)

    return Handler


def _routes(api):
    s = api.store
    by = lambda q, body=None: (body or {}).get("by") or q.get("by") or ""
    R = []

    def route(method, path):
        def deco(fn):
            R.append((method, re.compile(path), fn))
            return fn
        return deco

    @route("GET", r"/api/status")
    def status(h, q):
        h._send(200, {"version": "0.1.0", "workspace": str(config.WORKSPACE), "engines": engines.available_engines(),
                      "templates": templates.TEMPLATES, "audiences": sorted(api.cfg.get("audiences", {})),
                      "models": config.MODELS, "people": [p["name"] for p in api.people()],
                      "delete_media": api.cfg["delete_media_after_transcript"], "claude_model": api.cfg["claude"]["model"]})

    @route("GET", r"/api/doctor")
    def doctor(h, q):
        h._send(200, engines.doctor())

    @route("GET", r"/api/skills")
    def skill_list(h, q):
        h._send(200, skills.listing(api.cfg))

    @route("GET", r"/api/meetings")
    def meetings(h, q):
        h._send(200, s.list())

    @route("POST", r"/api/meetings")
    def create(h, q):
        body = h._json()
        meta = {k: body.get(k) for k in ("title", "date", "audience", "template", "chair", "attendees", "objective",
                                          "validator", "distribution", "classification", "author",
                                          "period_from", "period_to", "overall") if body.get(k) not in (None, "")}
        h._send(200, s.create(meta, by(q, body)))

    @route("GET", r"/api/meetings/([\w-]+)")
    def get_meeting(h, q, mid):
        h._send(200, s.get(mid))

    @route("POST", r"/api/meetings/([\w-]+)/meta")
    def meta(h, q, mid):
        body = h._json()
        h._send(200, s.update_meta(mid, body.get("changes", {}), by(q, body)))

    @route("POST", r"/api/meetings/([\w-]+)/upload")
    def upload(h, q, mid):
        length = int(h.headers.get("Content-Length") or 0)
        h._send(200, api.upload(mid, q.get("name", "recording"), h.rfile, length, by(q)))

    @route("POST", r"/api/meetings/([\w-]+)/transcribe")
    def transcribe(h, q, mid):
        body = h._json()
        h._send(200, api.start_transcription(mid, body.get("engine", ""), body.get("model", ""), by(q, body),
                                             float(body.get("speed") or 1), float(body.get("pace") or 1),
                                             body.get("language") or ""))

    @route("GET", r"/api/jobs/(\w+)")
    def job(h, q, jid):
        if jid not in JOBS:
            raise KeyError("Unknown job")
        h._send(200, JOBS[jid])

    @route("GET", r"/api/meetings/([\w-]+)/transcript")
    def get_transcript(h, q, mid):
        h._send(200, api.transcript(mid, q.get("v")))

    @route("POST", r"/api/meetings/([\w-]+)/transcript")
    def save_transcript(h, q, mid):
        body = h._json()
        t = api.transcript(mid)
        t["segments"] = governance.flag_transcript(body["segments"])
        h._send(200, s.save_version(mid, "transcript", t, by(q, body), body.get("message") or "Transcript corrected"))

    @route("POST", r"/api/meetings/([\w-]+)/minutes/offline")
    def offline(h, q, mid):
        body = h._json()
        md, found, _meta, _t = api.offline(mid, body.get("template") or "recording")
        entry = s.save_version(mid, "minutes", md, by(q, body), "Offline draft") if body.get("save") else None
        h._send(200, {"markdown": md, "checks": checks.run(md), "version": entry,
                      "counts": {k: len(v) for k, v in found.items()}})

    @route("GET", r"/api/meetings/([\w-]+)/minutes")
    def get_minutes(h, q, mid):
        md = s.version(mid, "minutes", q["v"]) if q.get("v") else s.latest(mid, "minutes")
        h._send(200, {"markdown": md, "checks": checks.run(md) if md else None})

    @route("POST", r"/api/meetings/([\w-]+)/minutes")
    def save_minutes(h, q, mid):
        body = h._json()
        md = body.get("markdown") or ""
        if not body.get("message"):
            raise ValueError("Say what changed – a version message is required")
        h._send(200, {"version": s.save_version(mid, "minutes", md, by(q, body), body["message"]), "checks": checks.run(md)})

    @route("POST", r"/api/meetings/([\w-]+)/checks")
    def run_checks(h, q, mid):
        h._send(200, checks.run(h._json().get("markdown") or ""))

    @route("POST", r"/api/meetings/([\w-]+)/claude/preview")
    def preview(h, q, mid):
        h._send(200, api.claude_preview(mid, h._json().get("template") or "recording"))

    @route("POST", r"/api/meetings/([\w-]+)/claude/draft")
    def cdraft(h, q, mid):
        body = h._json()
        h._send(200, api.claude_draft(mid, body.get("template") or "recording", body.get("sha"), body.get("confirm"),
                                      by(q, body)))

    @route("POST", r"/api/meetings/([\w-]+)/signoff")
    def signoff(h, q, mid):
        body = h._json()
        if not body.get("by"):
            raise ValueError("Sign-off needs the approver's name")
        h._send(200, s.signoff(mid, body["by"], body.get("role") or "Chair"))

    @route("GET", r"/api/meetings/([\w-]+)/export")
    def export(h, q, mid):
        data, name, ctype = api.export(mid, q.get("format", "md"), q.get("v"))
        s.audit("export", q.get("by", ""), mid, f"{q.get('format', 'md')} {name}")
        h._send(200, data, ctype, {"Content-Disposition": f"attachment; filename=\"{name}\""})

    @route("GET", r"/api/meetings/([\w-]+)/media/(.+)")
    def get_media(h, q, mid, name):
        path = s.media_path(mid, name)
        h._send(200, path.read_bytes(), mimetypes.guess_type(path.name)[0] or "application/octet-stream")

    @route("POST", r"/api/meetings/([\w-]+)/media/delete")
    def delete_media(h, q, mid):
        body = h._json()
        h._send(200, {"deleted": s.delete_media(mid, by(q, body), "deleted by user")})

    @route("POST", r"/api/wer")
    def wer(h, q):
        body = h._json()
        hyp = body.get("hypothesis")
        if not hyp and body.get("meeting"):
            hyp = " ".join(x["text"] for x in api.transcript(body["meeting"])["segments"])
        h._send(200, governance.error_rates(body.get("reference") or "", hyp or ""))

    @route("GET", r"/api/audit")
    def audit(h, q):
        path = Path(s.root) / "audit.log"
        lines = path.read_text(encoding="utf-8").splitlines()[-300:] if path.exists() else []
        entries = [json.loads(l) for l in lines]
        if q.get("meeting"):
            entries = [e for e in entries if e["meeting"] == q["meeting"]]
        h._send(200, entries[::-1])

    return R


def serve(cfg=None, port=None):
    cfg = cfg or config.load()
    port = port or int(cfg["port"])
    host = cfg["host"]
    allowed = {f"127.0.0.1:{port}", f"localhost:{port}", f"[::1]:{port}"}
    store = Store(config.WORKSPACE)
    httpd = ThreadingHTTPServer((host, port), make_handler(Api(cfg, store), allowed))
    return httpd
