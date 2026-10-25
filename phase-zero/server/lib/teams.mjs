// Microsoft Teams chat-log import: pull decisions, actions, risks and issues out of a pasted thread.
// Output is a list of RAID candidates the PM confirms; nothing is added to the RAID log automatically.

const MESSAGE_HEADERS = [
  // [18/10/2026 10:15] Name: text   |   [10:15 AM] Name: text
  /^\[([^\]]+)\]\s*([^:]{2,60}):\s*(.*)$/,
  // Name  18/10/2026 10:15  (Teams copy-paste: header line, text on following lines)
  /^([A-Z][\w .'-]{1,60}?)\s{2,}(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}.*|\d{1,2}:\d{2}.*)$/,
];

const RULES = [
  { kind: 'Decision', re: /\b(decided|agreed|approved|we will go with|final decision|confirmed)\b/i },
  { kind: 'Action', re: /\b(will|action|to do|todo|please|kindly|follow up|by (sun|mon|tue|wed|thu|fri|sat)|by \d{1,2}[/.-]\d{1,2}|deadline|@\w+)\b/i },
  { kind: 'Risk', re: /\b(risk|concern|might|may delay|could slip|worried)\b/i },
  { kind: 'Issue', re: /\b(issue|problem|bug|down|failed|failing|blocked|blocker|not working|outage)\b/i },
];

const DATE = /\b(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?|(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)(?:day)?|tomorrow|today|end of (?:week|day|month))\b/i;
const PRONOUNS = new Set(['I', 'We', 'You', 'They', 'He', 'She', 'It', 'This', 'That', 'Team', 'Someone', 'Who']);
const OWNER = /@([A-Z][\w.]+(?:\s[A-Z][\w.]+)?)|\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+will\b/;

export function parseMessages(text) {
  const out = [];
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = MESSAGE_HEADERS[0].exec(line))) {
      cur = { at: m[1], author: m[2].trim(), text: m[3] };
      out.push(cur);
    } else if ((m = MESSAGE_HEADERS[1].exec(line))) {
      cur = { at: m[2].trim(), author: m[1].trim(), text: '' };
      out.push(cur);
    } else if (cur) {
      cur.text = cur.text ? `${cur.text} ${line}` : line;
    } else {
      cur = { at: '', author: '', text: line };
      out.push(cur);
    }
  }
  return out;
}

export function extractRaidCandidates(text) {
  const candidates = [];
  for (const msg of parseMessages(text)) {
    for (const sentence of msg.text.split(/(?<=[.!?])\s+/)) {
      const rule = RULES.find((r) => r.re.test(sentence));
      if (!rule) continue;
      const o = OWNER.exec(sentence);
      const name = o ? (o[1] || o[2]).trim() : '';
      const d = DATE.exec(sentence);
      candidates.push({
        kind: rule.kind,
        text: sentence.trim(),
        owner: name && !PRONOUNS.has(name.split(' ')[0]) ? name : 'TBC – requires assignment',
        due: d ? d[1] : 'not set',
        author: msg.author,
        at: msg.at,
      });
    }
  }
  return candidates;
}
