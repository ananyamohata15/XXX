/**
 * Compose the sentence the parser reads (XXX-43, Session 15 CP4 defect 2).
 *
 * Lives in its own module so it is testable without mounting the client — the
 * defect it fixes is a composition bug, and a composition bug that can only be
 * verified by clicking is a defect that comes back.
 *
 * THE DEFECT: the chip rail called `readIt(chip.text)`, which parsed the
 * canned string ALONE. Tapping a chip after typing discarded the typed words;
 * tapping two chips kept only the second. The founder typed "shopping, pub
 * hopping and food for today" and the request that reached the engine did not
 * contain it.
 *
 * ONE STRING rather than a structured merge, deliberately: the parser's job IS
 * reading a sentence, so handing it "shopping and pub hopping, today" lets it
 * do the composing it is already good at. Merging structurally here would be a
 * second parser written in TypeScript, which is two things to keep in step.
 */
export function composeSentence(typed: string, chips: readonly string[]): string {
  return [typed.trim(), ...chips].filter((p) => p.length > 0).join(", ");
}
