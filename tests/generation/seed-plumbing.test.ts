/**
 * The seed reaches the site (XXX-35, Session 12 §5.3 → Session 13 Step 1).
 *
 * Session 12's mining pass found that every day the tasting room had ever
 * generated was composed at seed **0**. The engine minted a seed, scored and
 * retrieved with it, and recorded it in the trace; `buildSkeleton` re-read
 * `request.seed`, which the room sends as `null`, and fell to 0. Six of the
 * nine selection points that session refitted — every composition die and the
 * arc template itself — therefore never varied on the live surface, and every
 * room trace recorded a seed beside an arc that seed did not build.
 *
 * The standing line it earned:
 *
 *   > A die nobody plumbed is a die nobody rolled — verify the seed reaches
 *   > the site, not just that the site accepts one.
 *
 * These are that verification. They are deliberately about PLUMBING rather
 * than about any one die: each asserts something that was false before the
 * fix and cannot be made true again by tuning.
 */

import { describe, expect, it } from "vitest";
import { ARC_TEMPLATES, pickTemplate, templatesFor } from "@/server/generation/arc";
import { buildSkeleton } from "@/server/generation/compose";
import { resolveSeed } from "@/server/generation/engine";
import type { GenerationRequest } from "@/server/generation/types";
import { GOLDEN_PERSONAS } from "@/shared/persona";

const DATE = "2026-09-19"; // a Saturday

/**
 * A request shaped exactly like the one `TastingRoom.tsx` sends: no seed.
 * The room is the only caller that omits it, which is why the defect lived
 * on the one surface no harness exercised — every offline run passed
 * `--seed` explicitly and so exercised the real dice.
 */
const roomRequest = (
  over: Partial<GenerationRequest> = {},
): GenerationRequest => ({
  city: "toronto",
  date: DATE,
  persona: GOLDEN_PERSONAS["day-6-excursion"],
  budgetBand: null,
  transport: ["walk", "transit"],
  seed: null as unknown as undefined, // the room's literal wire value
  ...over,
});

describe("the room's day is diced at a real seed", () => {
  it("mints a different seed per generation when the caller sends none", () => {
    const seeds = new Set(
      Array.from({ length: 50 }, () => resolveSeed(roomRequest())),
    );
    // Before the fix the room's effective seed was the constant 0.
    expect(seeds.size).toBeGreaterThan(1);
    expect(seeds.has(0)).toBe(false);
  });

  it("honours a caller's seed exactly — an explicit seed is never re-minted", () => {
    expect(resolveSeed(roomRequest({ seed: 679721290 }))).toBe(679721290);
    // 0 is a legitimate seed a caller may ask for, and must survive the
    // nullish check that used to manufacture it.
    expect(resolveSeed(roomRequest({ seed: 0 }))).toBe(0);
  });

  it("varies the ARC across room generations, not just the venues", () => {
    // The founder's verdict was "a random list of items" — different places,
    // identical shape. Shape is the template, so the template is what has to
    // move. day-6-excursion is scheduler/moderate: four templates to draw
    // from, sampled 200 times, so seeing only one is a plumbing failure and
    // not a coincidence (4 × (1/4)^200).
    const templates = new Set(
      Array.from({ length: 200 }, () => {
        const request = roomRequest();
        const seed = resolveSeed(request);
        return buildSkeleton(request, { seed }).templateId;
      }),
    );
    expect(templates.size).toBeGreaterThan(1);
  });
});

describe("reproducibility law: the recorded seed rebuilds the recorded day", () => {
  it.each(Object.keys(GOLDEN_PERSONAS))(
    "%s — the trace's seed reproduces the trace's arc_template_id",
    (key) => {
      const persona = GOLDEN_PERSONAS[key];
      for (let i = 0; i < 25; i += 1) {
        const request = roomRequest({ persona });
        // What the engine does: resolve once, compose from that, record it.
        const recordedSeed = resolveSeed(request);
        const recordedTemplateId = buildSkeleton(request, {
          seed: recordedSeed,
        }).templateId;

        // What a later reader of the trace does: replay the recorded seed.
        const replayed = pickTemplate(persona, recordedSeed);
        expect(replayed.id, `${key} seed=${recordedSeed}`).toBe(
          recordedTemplateId,
        );
        expect(templatesFor(persona).map((t) => t.id)).toContain(
          recordedTemplateId,
        );
      }
    },
  );

  it("composes the same day twice from one seed — replay is exact", () => {
    const request = roomRequest();
    const seed = resolveSeed(request);
    expect(buildSkeleton(request, { seed })).toEqual(
      buildSkeleton(request, { seed }),
    );
  });
});

describe("request.seed cannot reach composition", () => {
  /**
   * The defect's direct anti-regression. `request.seed` is an input the
   * engine reads once; composition is told the resolved seed and must be
   * blind to the request's own field. If this ever fails, the two meanings
   * have been re-merged.
   */
  it("ignores request.seed entirely — only the resolved seed builds the day", () => {
    const resolved = 42;
    const fromNullRequest = buildSkeleton(roomRequest(), { seed: resolved });
    for (const decoy of [0, 1, 999, 679721290]) {
      const fromDecoyRequest = buildSkeleton(roomRequest({ seed: decoy }), {
        seed: resolved,
      });
      expect(fromDecoyRequest, `decoy request.seed=${decoy}`).toEqual(
        fromNullRequest,
      );
    }
  });

  it("moves the day when the RESOLVED seed moves", () => {
    // The other half of the same claim: blindness to `request.seed` must not
    // be achieved by being blind to seeds altogether.
    const request = roomRequest();
    const drawn = new Set(
      [0, 1, 2, 3, 4, 5, 6, 7].map(
        (seed) => buildSkeleton(request, { seed }).templateId,
      ),
    );
    expect(drawn.size).toBeGreaterThan(1);
  });
});

describe("the defect's signature, kept as a fixture", () => {
  /**
   * Session 12 reproduced the bug rather than reasoning about it: one live
   * trace recorded `arc_template_id: "moderate-b"` beside `seed: 679721290`,
   * and only seed 0 reproduced that template. Pinning both draws keeps the
   * evidence checkable — if `pickTemplate` is ever rekeyed, this test fails
   * and the historical record gets updated deliberately instead of quietly
   * becoming a story nobody can verify.
   */
  const persona = GOLDEN_PERSONAS["day-6-excursion"];

  it("seed 0 draws the template the room kept producing", () => {
    expect(pickTemplate(persona, 0).id).toBe("moderate-b");
  });

  it("the seed that trace actually recorded draws a different template", () => {
    expect(pickTemplate(persona, 679721290).id).toBe("moderate-d");
  });

  it("every template the defect hid is reachable", () => {
    // Six of nine dice sites were inert, so the room only ever saw the
    // shapes seed 0 happened to produce. All four moderate templates must
    // be drawable or the fix restored less variety than the audit claimed.
    const reachable = new Set(
      Array.from({ length: 500 }, (_, seed) => pickTemplate(persona, seed).id),
    );
    const expected = ARC_TEMPLATES.filter(
      (t) => t.structure === "scheduler" && t.pace === "moderate",
    ).map((t) => t.id);
    expect([...reachable].sort()).toEqual([...expected].sort());
  });
});
