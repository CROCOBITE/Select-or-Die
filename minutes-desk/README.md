# Minutes Desk

A small web tool that runs on your own computer. It turns a meeting **video or audio**, a **Teams
transcript**, a **WhatsApp chat export** or rough **notes** into minutes for committees, steering
groups, ticket reviews and other stakeholders. You can export them to Word, Markdown, a Teams or e-mail post,
and a one-line "MOM:" for a DevOps meeting task.

It is built for meetings in **Egyptian, Gulf/Saudi and Modern Standard Arabic mixed with English**.
Recordings stay on your computer. A Claude draft is optional and runs only after you have seen exactly what
will be sent and confirmed it.

## Quick start

```bash
# Windows (one time): install Python 3.10+ and ffmpeg, then
scripts\install-windows.bat        # creates .venv, installs speech models' libraries, runs Doctor
scripts\start-windows.bat          # opens http://127.0.0.1:4330

# macOS / Linux / WSL
scripts/install.sh
scripts/start.sh
```

Without the speech libraries the tool still works for Teams transcripts, WhatsApp exports and notes. For
recordings, run `python -m minutes_desk doctor` to see what is missing on this machine.

Tests: `python -m unittest discover -s tests` (standard library only; 28 tests).

## How it works

1. **Describe the meeting**: title, date, audience, template, chair, attendees, the business objective it
   serves, the validator and the distribution list. Audiences in `workspace/config.json` fill in the chair,
   validator, distribution and template.
2. **Add the recording or transcript.**
   - Recordings are decoded with ffmpeg, split at quiet points (no word is cut at a chunk edge) and
     transcribed with a dialect Whisper model chosen for this machine.
   - **Saved speed:** if you saved the file at 1.5x, 1.8x or 2x, say so. It is slowed back to normal before
     recognition and the times match the original meeting.
   - **Recognition pace:** 0.8x slows the speech a further 20%. Test it with the Pilot before using it widely
     (see "Measured accuracy").
   - **Language:** use "Mixed Arabic and English" for meetings that switch languages. Forcing Arabic writes
     English terms in Arabic script.
   - Silent recordings are refused, and silent stretches are skipped, because Whisper invents text on silence.
3. **Check the transcript.** Each flagged segment is marked: a known Whisper filler phrase, a repetition loop,
   impossible speech rate, a low-confidence word, or a number to confirm. Correct the text in place; each
   save is a new version.
4. **Draft the minutes.** The offline draft always runs and never leaves the computer. *Draft with Claude…*
   shows the exact redacted text first: phones, e-mails, national IDs/Iqama and record numbers are masked.
   You tick a confirmation, and the text sent must match the preview exactly (its hash is checked).
5. **Pre-issue checks and scorecard.** Every draft is scored against six PM reporting standards:
   organisation and planning, analysis, business context, information gathering, report structure and
   terminology. Each finding names the line to fix.
6. **Approve and export.** Approval is recorded against a saved version; any later edit clears it. Word
   exports use the document palette: Dubai, navy 1F3864, zebra rows, house oranges for RAG, A4, a
   classification header and "Page X of Y".

### Templates

All templates share one spine, in this order:

1. Document control
2. Read this first
3. Management summary
4. Participants
5. *template-specific sections*
6. Decisions
7. Actions
8. Open issues and root cause
9. Conflicts
10. Requirements and scope
11. To confirm before sending (one consolidated request pack)
12. PMO judgement
13. Discussion – as written

The template-specific sections:

| Template | Adds |
|---|---|
| Meeting from a recording | — (the default) |
| Ticket / working meeting | Tickets discussed (ticket, outcome, owner, due) |
| Committee | Agenda register, "What we need back" |
| Steering / leadership | Table A (KPIs moved, was → now), Table B (gaps: today, target, due, owner), For decision |
| Quick follow-up | Decisions, actions and issues only |
| Lecture or training | Key points, questions raised |
| Management chat digest | Activity by day for the period you set |

Nothing is invented. An owner appears only when someone was named, and a date only when one was said. Relative
dates ("بكرة", "next week", "يوم الخميس") are resolved against the meeting date and keep the words used.

## Engines and models

| Engine | When | Notes |
|---|---|---|
| `whisper` (Hugging Face transformers) | Any OS, CPU or GPU | Dialect fine-tunes below; first use downloads the model |
| `arabic-transcribe` | If [ssagga/arabic-transcribe](https://github.com/ssagga/arabic-transcribe) is installed (macOS/Linux/WSL) | Cohere Transcribe Arabic + WhisperX alignment, per-word confidence; best measured Saudi-dialect accuracy; gated model, about 10 GB |

| Model | Dialect | Licence | CPU |
|---|---|---|---|
| `oddadmix/whisper-medium-arabic-dialectal` | Egyptian, Levantine, Gulf | Apache-2.0 | yes |
| `MAdel121/whisper-small-egyptian-arabic` | Egyptian | MIT | fastest |
| `AbdelrahmanHassan/whisper-large-v3-egyptian-arabic` | Egyptian (MGB-3) | Apache-2.0 | GPU |
| `wageehkhad/whisper-medium-finetuned-sada-asr` | Saudi / Gulf (SADA22) | Apache-2.0 | yes |
| `mesoj8/whisper-large-v3-arabic-dialect-30s` | Mixed | **not stated** – do not use for work output | GPU |
| `openai/whisper-large-v3` | MSA, English | Apache-2.0 | GPU |

Published word-error-rate figures are claims. Use **Pilot – measure accuracy** on 5–10 minutes of your own
audio before trusting a model. A WER under about 25% is workable for minutes. Above 40%, use another model or
the Teams transcript.

## Measured accuracy

<!-- benchmark table inserted below -->

## Rollout

1. **Pilot (week 1).** One recurring meeting. Run the Pilot on two clips and pick the model and pace with the
   lowest WER. Compare the minutes with your own.
2. **Limited (weeks 2–3).** Ticket reviews and follow-ups. Track the scorecard: no Weak standard at issue.
3. **Full.** Committees and steering. The validator signs off in the tool before distribution.

Go back a step if WER rises above 40% on a new meeting type, or if a Claude draft contradicts the transcript.

## Privacy and security

- Binds to `127.0.0.1`. Requests with a non-local `Host` header are refused (DNS rebinding), and every write
  needs the `X-Minutes-Desk: 1` header, so another web page cannot drive the tool.
- `workspace/` is git-ignored. It holds meetings, versions, the audit log and your config with audiences and
  people.
- Recordings are deleted after transcription by default (`delete_media_after_transcript`).
- The tool **never writes to Azure DevOps**. Paste the "MOM:" line yourself.
- Everything is in the audit log: upload, transcription, Claude send (with the payload hash and redaction
  counts), save, approval, export and deletion.

## Configuration

Copy `config.example.json` to `workspace/config.json`. The keys:

- `audiences`: name → template, chair, validator, distribution, classification.
- `people`: name, role and aliases, so owners are recognised in Arabic or English.
- `dialect`, `language`, `engine`, `model`, `chunk_seconds`, `delete_media_after_transcript`.
- `claude`: model and effort.
- `skills_dir`, `skills_for_minutes`: SKILL.md files added to the Claude drafting prompt.

Third-party code and models: see `THIRD_PARTY_NOTICES.md`.
