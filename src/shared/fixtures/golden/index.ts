/**
 * The golden set as fixtures (XXX-26) — the day-grammar validator's
 * permanent exam.
 *
 * Six founder-verified days that must validate with zero violations, and
 * the trap fixtures that must be caught. Both directions matter: a
 * validator that passes everything is worthless, and one that rejects the
 * founder's own days is worse.
 */

export { goldenDay1 } from "./day-1-jays";
export { goldenDay2 } from "./day-2-old-town";
export { goldenDay3 } from "./day-3-winter";
export { goldenDay4 } from "./day-4-budget";
export { goldenDay5 } from "./day-5-wanderer";
export { goldenDay6 } from "./day-6-excursion";
export { contextFor } from "./support";
export type { GoldenDay } from "./support";

import { goldenDay1 } from "./day-1-jays";
import { goldenDay2 } from "./day-2-old-town";
import { goldenDay3 } from "./day-3-winter";
import { goldenDay4 } from "./day-4-budget";
import { goldenDay5 } from "./day-5-wanderer";
import { goldenDay6 } from "./day-6-excursion";
import type { GoldenDay } from "./support";

export const GOLDEN_DAYS: readonly GoldenDay[] = [
  goldenDay1,
  goldenDay2,
  goldenDay3,
  goldenDay4,
  goldenDay5,
  goldenDay6,
];
