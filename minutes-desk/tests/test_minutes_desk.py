"""Tests: python -m unittest discover -s tests   (standard library only, no models needed)."""

import io
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ["MINUTES_DESK_WORKSPACE"] = tempfile.mkdtemp(prefix="md-test-")

from minutes_desk import (arabic, checks, claude_draft, config, docx, extract, governance, importers,  # noqa: E402
                          media, server, templates)
from minutes_desk.store import Store  # noqa: E402

VTT = """WEBVTT

00:00:01.000 --> 00:00:05.000
<v Laila>اتفقنا إن الريليز يوم الخميس.</v>

00:00:05.500 --> 00:00:09.000
<v Sara>QA بتقول التذكرة #4821 لسه فيها مشكلة بس التيم بيقول اتحلت.</v>

00:00:09.500 --> 00:00:14.000
<v Laila>يا Omar لازم تبعت الـ fix بكرة.</v>

00:00:14.500 --> 00:00:18.000
<v Omar>عايزين السيستم يبعت رسالة للمريض لما الحجز يتأكد.</v>
"""

WHATSAPP = """[10/1/26, 9:01:00 AM] Karim Fathy: صباح الخير
[10/1/26, 9:05:12 AM] +20 10 12345678: @Nour Adel لازم نرفع الكليمز قبل الخميس
[10/1/26, 9:06:00 AM] Nour Adel: تمام هيتعمل
السبب إن السيستم كان واقف
[10/2/26, 11:00:00 AM] Karim Fathy: Messages and calls are end-to-end encrypted.
"""


class ArabicTests(unittest.TestCase):
    def test_normalise_unifies_letters_and_digits(self):
        self.assertEqual(arabic.normalise("أَحْمَد ٢٠٢٦ مدرسة"), "احمد 2026 مدرسه")

    def test_direction(self):
        self.assertEqual(arabic.direction("اتفقنا على الموعد on Sunday"), "rtl")
        self.assertEqual(arabic.direction("Release on Thursday يوم"), "ltr")


class GovernanceTests(unittest.TestCase):
    def test_hallucination_and_repetition_flags(self):
        codes = lambda t: [f["code"] for f in governance.segment_flags({"text": t, "start": 0, "end": 10})]
        self.assertIn("hallucination", codes("ترجمة نانسي قنقر"))
        self.assertIn("repetition", codes("نحن نحن نحن نحن نحن نحن نحن"))
        self.assertIn("verify-number", codes("التكلفة تلاتة آلاف"))

    def test_redaction_masks_contacts_and_ids(self):
        text, counts = governance.redact("call +20 10 1234 5678 or 0551234567, mail a.b@x.com, iqama 2123456789, MRN 445566")
        self.assertNotIn("1234", text)
        self.assertNotIn("a.b@x.com", text)
        self.assertEqual(counts.get("email"), 1)
        self.assertGreaterEqual(counts.get("phone", 0), 2)

    def test_naming_rule(self):
        self.assertEqual(governance.apply_naming("Update ADO and the CRM"), "Update DevOps and the Tickets System")

    def test_error_rates(self):
        r = governance.error_rates("اتفقنا على الموعد", "اتفقنا علي الموعد")
        self.assertEqual(r["wer"], 0.0)  # ى/ي normalised
        self.assertGreater(governance.error_rates("a b c d", "a x c")["wer"], 0.4)


class MediaTests(unittest.TestCase):
    def test_tempo_filter_restores_speed_and_pace(self):
        self.assertEqual(media.tempo_filter(1), [])
        self.assertEqual(media.tempo_filter(2), ["-af", "atempo=0.5"])
        self.assertEqual(media.tempo_filter(1, 0.8), ["-af", "atempo=0.8"])
        self.assertEqual(media.tempo_filter(2, 0.8), ["-af", "atempo=0.5,atempo=0.8"])
        with self.assertRaises(ValueError):
            media.tempo_filter(9)

    def test_meeting_clock_rescale(self):
        from minutes_desk import engines
        segs = [{"start": 10.0, "end": 20.0, "words": [{"start": 12.5, "end": 13.0}]}]
        engines._to_meeting_clock(segs, 0.8)
        self.assertEqual((segs[0]["start"], segs[0]["end"], segs[0]["words"][0]["start"]), (8.0, 16.0, 10.0))


class ImporterTests(unittest.TestCase):
    def test_vtt_with_speakers(self):
        segs = importers.parse("call.vtt", VTT.encode())["segments"]
        self.assertEqual(len(segs), 4)
        self.assertEqual(segs[0]["speaker"], "Laila")
        self.assertEqual(segs[2]["start"], 9.5)

    def test_whatsapp_masks_numbers_and_merges(self):
        parsed = importers.parse("chat.txt", WHATSAPP.encode())
        self.assertEqual(parsed["kind"], "whatsapp")
        segs = parsed["segments"]
        self.assertEqual(segs[1]["speaker"], "Unsaved contact …678")
        self.assertIn("السبب", segs[2]["text"])        # continuation line kept with its message
        self.assertEqual(len(importers.merge_chats([segs, segs])), len(segs))

    def test_teams_docx(self):
        buf = io.BytesIO()
        ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
        body = "".join(f"<w:p><w:r><w:t>{t}</w:t></w:r></w:p>" for t in ["Laila Hassan   0:03", "We agreed the go-live date.", "Omar   0:10", "I will send it."])
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("word/document.xml", f"<w:document {ns}><w:body>{body}</w:body></w:document>")
        segs = importers.parse("t.docx", buf.getvalue())["segments"]
        self.assertEqual([s["speaker"] for s in segs], ["Laila Hassan", "Omar"])
        self.assertEqual(segs[1]["start"], 10.0)


class ExtractTests(unittest.TestCase):
    def setUp(self):
        segs = governance.flag_transcript(importers.parse("call.vtt", VTT.encode())["segments"])
        self.found = extract.extract(segs, date(2026, 10, 25), [{"name": "Omar Khaled", "aliases": ["Omar"]}])

    def test_decision_action_conflict_requirement(self):
        f = self.found
        self.assertEqual(len(f["decisions"]), 1)
        action = next(a for a in f["actions"] if "fix" in a["text"])
        self.assertEqual(action["owner"], "Omar Khaled")
        self.assertEqual(action["due"]["date"], "2026-10-26")     # بكرة resolved from the meeting date
        self.assertTrue(action["due"]["resolved"])
        self.assertEqual(len(f["conflicts"]), 1)
        self.assertEqual(len(f["requirements"]), 1)
        self.assertIn("[role TBC]", f["requirements"][0]["story"])

    def test_owner_never_guessed(self):
        found = extract.extract([{"text": "لازم حد يراجع الفاتورة", "start": 1}], date(2026, 10, 25), [])
        self.assertTrue(found["actions"][0]["owner"].startswith("TBC"))

    def test_weekday_and_explicit_dates(self):
        day = date(2026, 10, 25)  # a Sunday
        self.assertEqual(extract.resolve_due("قبل يوم الخميس", day)["date"], "2026-10-29")
        self.assertEqual(extract.resolve_due("by 3/11", day)["date"], "2026-11-03")


class TemplateAndCheckTests(unittest.TestCase):
    def build(self, template):
        t = {"engine": "import", "kind": "vtt",
             "segments": governance.flag_transcript(importers.parse("call.vtt", VTT.encode())["segments"])}
        found = extract.extract(t["segments"], date(2026, 10, 25), [{"name": "Omar Khaled", "aliases": ["Omar"]}])
        return templates.build(template, {"title": "Ticket review", "date": "2026-10-25", "attendees": ["Laila", "Omar"]}, t, found)

    def test_every_template_has_the_spine(self):
        for name in templates.TEMPLATES:
            md = self.build(name)
            secs = checks.sections(md)
            for required in ("Document control", "Management summary", "To confirm before sending"):
                self.assertIn(required, secs, f"{name} misses {required}")

    def test_ticket_template_lists_tickets(self):
        self.assertIn("#4821", self.build("ticket"))

    def test_checks_and_scorecard(self):
        md = self.build("recording")
        r = checks.run(md)
        self.assertLess(r["score"], 100)
        self.assertEqual(len(r["scorecard"]), 6)
        self.assertTrue(any("no due date" in f["text"] or "no named owner" in f["text"] for f in r["findings"]))

    def test_banned_wording_and_team_owner(self):
        md = ("## Actions\n\n| # | Action | Owner | Due | Priority | Status | Source |\n|---|---|---|---|---|---|---|\n"
              "| A1 | x | Scrum 3 team | ASAP | High | Open | 00:01 |\n\nWe are working on the baseline.\n")
        texts = " ".join(f["text"] for f in checks.run(md)["findings"])
        self.assertIn("is a team", texts)
        self.assertIn("Vague timing", texts)
        self.assertIn("Baseline", texts)


class DocxTests(unittest.TestCase):
    def test_docx_is_valid_and_styled(self):
        data = docx.build("# T\n\n## Actions\n\n| # | Owner |\n|---|---|\n| A1 | High |\n\nاتفقنا على الموعد\n", "T")
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            xml = z.read("word/document.xml").decode()
            self.assertIn('w:fill="1F3864"', xml)       # navy header
            self.assertIn('w:fill="C0511B"', xml)       # High in house orange
            self.assertIn("<w:bidi/>", xml)             # Arabic paragraph right-to-left
            self.assertIn("NUMPAGES", z.read("word/footer1.xml").decode())
            from xml.dom import minidom
            for name in z.namelist():
                if name.endswith(".xml") or name.endswith(".rels"):
                    minidom.parseString(z.read(name))


class ClaudePayloadTests(unittest.TestCase):
    def test_payload_is_redacted_and_hashed(self):
        t = {"segments": [{"text": "call me on 0551234567", "start": 0, "flags": []}]}
        cfg = dict(config.load(), skills_for_minutes=[])
        p = claude_draft.build_payload({"title": "x"}, t, "# x", "recording", cfg)
        self.assertNotIn("0551234567", p["user"])
        self.assertEqual(len(p["sha"]), 64)


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = server.serve(config.load(), port=0)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def call(self, path, body=None, raw=None, headers=None, host=None):
        h = {"X-Minutes-Desk": "1"} if body is not None or raw is not None else {}
        h.update(headers or {})
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        if body is not None:
            h["Content-Type"] = "application/json"
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=data, headers=h)
        if host:
            req.add_unredirected_header("Host", host)
        with urllib.request.urlopen(req) as res:
            text = res.read()
            return json.loads(text) if res.headers.get_content_type() == "application/json" else text

    def test_write_needs_header(self):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}/api/meetings", data=b"{}", method="POST")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 403)

    def test_foreign_host_refused(self):
        import http.client
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        conn.putrequest("GET", "/api/status", skip_host=True)
        conn.putheader("Host", "evil.example:80")
        conn.endheaders()
        self.assertEqual(conn.getresponse().status, 421)

    def test_full_flow_import_minutes_export_signoff(self):
        m = self.call("/api/meetings", {"title": "Ticket review", "date": "2026-10-25", "attendees": ["Laila"]})
        up = self.call(f"/api/meetings/{m['id']}/upload?name=call.vtt", raw=VTT.encode())
        self.assertEqual(up["kind"], "transcript")
        r = self.call(f"/api/meetings/{m['id']}/minutes/offline", {"template": "ticket", "save": True})
        self.assertIn("Tickets discussed", r["markdown"])
        docx_bytes = self.call(f"/api/meetings/{m['id']}/export?format=docx")
        self.assertTrue(docx_bytes.startswith(b"PK"))
        mom = self.call(f"/api/meetings/{m['id']}/export?format=mom").decode()
        self.assertTrue(mom.startswith("MOM:"))
        sign = self.call(f"/api/meetings/{m['id']}/signoff", {"by": "Chair Person"})
        self.assertEqual(sign["v"], 1)
        with self.assertRaises(urllib.error.HTTPError):
            self.call(f"/api/meetings/{m['id']}/minutes", {"markdown": "# changed"})  # message required
        self.call(f"/api/meetings/{m['id']}/minutes", {"markdown": "# changed", "message": "edit"})
        self.assertIsNone(self.call(f"/api/meetings/{m['id']}")["signoff"])          # edit clears approval

    def test_claude_draft_needs_confirm_and_matching_preview(self):
        m = self.call("/api/meetings", {"title": "x"})
        self.call(f"/api/meetings/{m['id']}/upload?name=call.vtt", raw=VTT.encode())
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.call(f"/api/meetings/{m['id']}/claude/draft", {"sha": "x", "confirm": False})
        self.assertEqual(ctx.exception.code, 403)
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.call(f"/api/meetings/{m['id']}/claude/draft", {"sha": "wrong", "confirm": True})
        self.assertEqual(ctx.exception.code, 403)

    def test_static_cannot_escape_web_root(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.call("/../minutes_desk/config.py")
        self.assertEqual(ctx.exception.code, 404)

    def test_unsupported_upload_rejected(self):
        m = self.call("/api/meetings", {"title": "x"})
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.call(f"/api/meetings/{m['id']}/upload?name=evil.exe", raw=b"MZ")
        self.assertEqual(ctx.exception.code, 400)


class StoreTests(unittest.TestCase):
    def test_bad_ids_rejected_and_versions_dedupe(self):
        st = Store(tempfile.mkdtemp())
        with self.assertRaises(KeyError):
            st.get("../../etc")
        m = st.create({"title": "x"})
        a = st.save_version(m["id"], "minutes", "# a")
        b = st.save_version(m["id"], "minutes", "# a")
        self.assertEqual(a["v"], b["v"])


if __name__ == "__main__":
    unittest.main()
