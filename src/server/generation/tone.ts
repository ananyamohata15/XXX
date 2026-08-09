/**
 * The mechanical tone bar, as pure code (CP1 §1.3). These are the same
 * register rules tests/day-grammar/describe.test.ts enforces on the
 * validator's own narration — the E2 bar: clipped, confident, no
 * hedging, no apology, no exclamation. LLM output passes through this
 * gate or is retried once and then replaced by `describeViolations`
 * text. The gate does not judge quality; it enforces register.
 */

const RULES: { name: string; bad: RegExp }[] = [
  { name: "no exclamation", bad: /!/ },
  { name: "no apology", bad: /\b(sorry|apolog|oops|unfortunately)/i },
  { name: "no hedging", bad: /\b(maybe|perhaps|possibly|might want)\b/i },
  // LLM-specific tics the validator never produces but a model will:
  { name: "no gushing", bad: /\b(amazing|incredible|wonderful|delightful|stunning|must-see|hidden gem)\b/i },
  { name: "no second-person cheerleading", bad: /\byou('ll| will) love\b/i },
  { name: "no emoji", bad: /\p{Extended_Pictographic}/u },
];

const MAX_CARD_REASON_CHARS = 220;
const MAX_DAY_NOTE_CHARS = 280;

export interface ToneBreach {
  text: string;
  rule: string;
}

export function checkTone(
  text: string,
  kind: "card" | "note",
): ToneBreach[] {
  const breaches: ToneBreach[] = [];
  for (const rule of RULES) {
    if (rule.bad.test(text)) breaches.push({ text, rule: rule.name });
  }
  const cap = kind === "card" ? MAX_CARD_REASON_CHARS : MAX_DAY_NOTE_CHARS;
  if (text.length > cap) {
    breaches.push({ text, rule: `over ${cap} chars` });
  }
  if (text.length > 0 && text[0] !== text[0].toUpperCase()) {
    breaches.push({ text, rule: "starts lowercase" });
  }
  return breaches;
}
