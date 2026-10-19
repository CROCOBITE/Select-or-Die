// Live AI review via the Claude API. Runs only when the human confirms each call (DEC-02).
// Personal identifiers are redacted before anything leaves the machine.
import fs from 'node:fs';
import path from 'node:path';

export const MODEL = 'claude-opus-5-5';

const REDACTIONS = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/(?:\+\d|\b\d)[\d\s-]{8,}\d\b/g, '[number]'],
  [/\b\d{10}\b/g, '[id]'],
];

export function redact(text) {
  return REDACTIONS.reduce((t, [re, rep]) => t.replace(re, rep), text);
}

export function loadSkillText(skillsDir, skill) {
  const dir = path.join(skillsDir, skill);
  if (!fs.existsSync(dir)) return '';
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort((a, b) => (a === 'SKILL.md' ? -1 : b === 'SKILL.md' ? 1 : a.localeCompare(b)))
    .map((f) => `<file name="${f}">\n${fs.readFileSync(path.join(dir, f), 'utf8')}\n</file>`)
    .join('\n');
}

const SYSTEM = `You are a reviewer inside Phase Zero, a project-management tool. You apply the attached skill's checklist to one project artifact (or a set of code files) and report findings.
Report every finding you can support from the text, most severe first. For each: severity (blocker, major, minor, info), the rule from the skill, a one-sentence message, and where (story ID, section or file:line).
Do not invent facts that are not in the artifact. Where information is missing, say what is missing.
Answer with only a JSON object: {"summary": string, "findings": [{"severity": string, "rule": string, "message": string, "where": string}]}`;

function parseJson(text) {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error('Model did not return JSON');
  const out = JSON.parse(m[0]);
  if (!Array.isArray(out.findings)) throw new Error('JSON has no findings array');
  return out;
}

/**
 * @param {{ skill: string, skillText: string, content: string }} req
 * Returns { summary, findings, model, redacted: true }.
 */
export async function liveReview({ skill, skillText, content }) {
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    throw new Error('Live review needs the Anthropic SDK: run "npm install" in phase-zero/.');
  }
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `<skill name="${skill}">\n${skillText || '(skill text not available locally – apply the skill by name)'}\n</skill>\n\n<artifact>\n${redact(content)}\n</artifact>`,
      },
    ],
  });
  if (response.stop_reason === 'refusal') {
    throw new Error(`The review was declined (${response.stop_details?.category ?? 'no category'}).`);
  }
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return { ...parseJson(text), model: response.model, redacted: true };
}
