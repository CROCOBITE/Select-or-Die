"""Meeting store on disk with append-only versions and an audit log.

workspace/meetings/<id>/meta.json          meeting details, status, sign-off
workspace/meetings/<id>/media/<file>       the recording (deleted after transcription by default)
workspace/meetings/<id>/transcript.vN.json
workspace/meetings/<id>/minutes.vN.md
workspace/meetings/<id>/versions.json      [{kind, v, sha, at, by, message}]
workspace/audit.log                        one JSON line per action
"""

import hashlib
import json
import re
import secrets
import shutil
import threading
from datetime import datetime
from pathlib import Path

_LOCK = threading.Lock()
SAFE_NAME = re.compile(r"[^\w.\-؀-ۿ ]+")


def now():
    return datetime.now().isoformat(timespec="seconds")


class Store:
    def __init__(self, root):
        self.root = Path(root)
        (self.root / "meetings").mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ basics
    def _dir(self, mid):
        if not re.fullmatch(r"[a-z0-9-]{6,40}", mid or ""):
            raise KeyError("Unknown meeting")
        path = self.root / "meetings" / mid
        if not path.is_dir():
            raise KeyError("Unknown meeting")
        return path

    def _read(self, path, default):
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default

    def _write(self, path, data):
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(path)

    def audit(self, action, by="", mid="", detail=""):
        line = json.dumps({"at": now(), "action": action, "by": by, "meeting": mid, "detail": detail}, ensure_ascii=False)
        with _LOCK, open(self.root / "audit.log", "a", encoding="utf-8") as f:
            f.write(line + "\n")

    # ------------------------------------------------------------------ meetings
    def create(self, meta, by=""):
        mid = datetime.now().strftime("%Y%m%d") + "-" + secrets.token_hex(3)
        path = self.root / "meetings" / mid
        (path / "media").mkdir(parents=True)
        meta = dict(meta, id=mid, created=now(), status="new", signoff=None)
        self._write(path / "meta.json", meta)
        self._write(path / "versions.json", [])
        self.audit("create", by, mid, meta.get("title", ""))
        return meta

    def list(self):
        out = []
        for p in sorted((self.root / "meetings").iterdir(), reverse=True):
            if (p / "meta.json").exists():
                meta = self._read(p / "meta.json", {})
                out.append({k: meta.get(k) for k in ("id", "title", "date", "audience", "status", "template")})
        return out

    def get(self, mid):
        path = self._dir(mid)
        meta = self._read(path / "meta.json", {})
        versions = self._read(path / "versions.json", [])
        return dict(meta, versions=versions, media=[m.name for m in (path / "media").iterdir()])

    def update_meta(self, mid, changes, by=""):
        path = self._dir(mid)
        meta = self._read(path / "meta.json", {})
        protected = {"id", "created", "signoff"}
        meta.update({k: v for k, v in changes.items() if k not in protected})
        self._write(path / "meta.json", meta)
        self.audit("meta", by, mid, ",".join(sorted(changes)))
        return meta

    # ------------------------------------------------------------------ media
    def save_media(self, mid, filename, stream, length, limit):
        if length > limit:
            raise ValueError(f"File is larger than the {limit // (1024 * 1024)} MB limit")
        name = SAFE_NAME.sub("_", Path(filename or "recording").name)[:120] or "recording"
        target = self._dir(mid) / "media" / name
        remaining = length
        with open(target, "wb") as f:
            while remaining > 0:
                chunk = stream.read(min(1 << 20, remaining))
                if not chunk:
                    break
                f.write(chunk)
                remaining -= len(chunk)
        if remaining:
            target.unlink(missing_ok=True)
            raise ValueError("Upload was interrupted")
        return target

    def media_path(self, mid, name):
        path = self._dir(mid) / "media" / Path(name).name
        if not path.is_file():
            raise KeyError("No such file")
        return path

    def delete_media(self, mid, by="", reason="retention"):
        media = self._dir(mid) / "media"
        names = [m.name for m in media.iterdir()]
        shutil.rmtree(media)
        media.mkdir()
        self.audit("delete-media", by, mid, f"{reason}: {', '.join(names)}")
        return names

    # ------------------------------------------------------------------ versions
    def save_version(self, mid, kind, content, by="", message=""):
        if kind not in ("transcript", "minutes"):
            raise ValueError("kind must be transcript or minutes")
        path = self._dir(mid)
        text = content if isinstance(content, str) else json.dumps(content, ensure_ascii=False, indent=1)
        sha = hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]
        with _LOCK:
            versions = self._read(path / "versions.json", [])
            mine = [v for v in versions if v["kind"] == kind]
            if mine and mine[-1]["sha"] == sha:
                return mine[-1]
            v = (mine[-1]["v"] + 1) if mine else 1
            ext = "json" if kind == "transcript" else "md"
            (path / f"{kind}.v{v}.{ext}").write_text(text, encoding="utf-8")
            entry = {"kind": kind, "v": v, "sha": sha, "at": now(), "by": by, "message": message or f"{kind} v{v}"}
            versions.append(entry)
            self._write(path / "versions.json", versions)
        if kind == "minutes":
            self._clear_signoff(mid)
        self.audit("save-" + kind, by, mid, f"v{v} {sha}")
        return entry

    def latest(self, mid, kind):
        versions = [v for v in self._read(self._dir(mid) / "versions.json", []) if v["kind"] == kind]
        return self.version(mid, kind, versions[-1]["v"]) if versions else None

    def version(self, mid, kind, v):
        ext = "json" if kind == "transcript" else "md"
        path = self._dir(mid) / f"{kind}.v{int(v)}.{ext}"
        if not path.exists():
            raise KeyError("No such version")
        text = path.read_text(encoding="utf-8")
        return json.loads(text) if kind == "transcript" else text

    # ------------------------------------------------------------------ sign-off
    def signoff(self, mid, by, role="Chair"):
        latest = [v for v in self._read(self._dir(mid) / "versions.json", []) if v["kind"] == "minutes"]
        if not latest:
            raise ValueError("Nothing to sign off yet")
        sign = {"by": by, "role": role, "at": now(), "v": latest[-1]["v"], "sha": latest[-1]["sha"]}
        self.update_meta(mid, {"status": "approved"}, by)
        meta = self._read(self._dir(mid) / "meta.json", {})
        meta["signoff"] = sign
        self._write(self._dir(mid) / "meta.json", meta)
        self.audit("signoff", by, mid, f"v{sign['v']} {sign['sha']}")
        return sign

    def _clear_signoff(self, mid):
        path = self._dir(mid) / "meta.json"
        meta = self._read(path, {})
        if meta.get("signoff"):
            meta["signoff"], meta["status"] = None, "draft"
            self._write(path, meta)
