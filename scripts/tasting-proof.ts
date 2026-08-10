import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { factDigest } from "../src/server/feedback/digest";

/**
 * Tasting-room proof harness (XXX-32/XXX-33, Session 10 CHECKPOINT 2).
 *
 * Runs the six CP2 proofs against a RUNNING app and the production
 * database, printing what actually landed rather than asserting quietly:
 *
 *   a  founder ✗ lands as tier-1 evidence AND flips the fact; the next
 *      generation for the same persona/date/seed reflects it
 *   b  a simulated USER report lands low-weight and flips nothing
 *   c  a simulated TRUSTED report lands high-weight, verification-queued,
 *      and flips nothing
 *   d  'not for me' lands in taste and is provably absent from evidence
 *   e  an unauthenticated request is 401 and leaks nothing
 *   f  the per-day self-cap refuses with 429
 *
 * Two modes:
 *   --live       (default) two real generations (~$0.8 list) and the full
 *                circle including "the next generation reflects it".
 *   --synthetic  no Google calls at all: the harness inserts one trace
 *                carrying a hand-built tasting context over REAL pool
 *                places, and every write path, authority rule and DB
 *                invariant is exercised for real. What it cannot show is
 *                the second half of (a) — a regeneration governed by the
 *                flipped fact — and it says so rather than implying it.
 *
 * Data hygiene: the flip writes a real tier-1 founder fact for a real
 * venue. Unless --keep-flip is passed, the harness DELETES that fact
 * afterwards — a fabricated "permanently closed" left in production
 * would be exactly the poisoned ground truth this whole design exists to
 * prevent. The evidence row is kept, with its free_text naming it a
 * harness artifact.
 *
 * Proof (f) inserts 12 synthetic traces tagged proof='self-cap-refusal'
 * and deletes exactly those rows again, by id.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/tasting-proof.ts \
 *     --base http://localhost:3000 [--synthetic] [--date 2026-08-15]
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

const arg = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const has = (flag: string): boolean => process.argv.includes(flag);

const BASE = arg("--base") ?? "http://localhost:3000";
const DATE = arg("--date") ?? "2026-08-15";
const PERSONA = arg("--persona") ?? "day-2-old-town";
const SEED = Number(arg("--seed") ?? 4242);
const SYNTHETIC = has("--synthetic");

const line = (s = "") => console.log(s);
const head = (s: string) => {
  line();
  line(`── ${s} ${"─".repeat(Math.max(0, 62 - s.length))}`);
};
let failures = 0;
const check = (label: string, ok: boolean, detail = ""): void => {
  if (!ok) failures++;
  line(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

interface PostResult {
  status: number;
  body: unknown;
}

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<PostResult> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep the raw text — a non-JSON body is itself evidence */
  }
  return { status: response.status, body: parsed };
}

interface TastingDay {
  status: string;
  day: {
    date: string;
    slots: { id: string; origin: string; placeId: string }[];
    places: Record<string, { name: string }>;
  };
  meter: {
    traceId: string;
    founderOverrides: number;
    estCostUsd: number;
    totalMs: number;
    quota: {
      generationsToday: number;
      dailyCap: number;
      detailsThisMonth: number;
      detailsFreeCap: number;
    };
  };
}

/** The card a claim is made about, in either mode. */
interface Card {
  slotId: string;
  placeId: string;
  name: string;
}

async function generate(secret: string): Promise<TastingDay> {
  const result = await post(
    "/api/tasting/generate",
    { personaKey: PERSONA, date: DATE, budgetMax: null, seed: SEED },
    { "x-tasting-secret": secret },
  );
  if (result.status !== 200) {
    throw new Error(
      `generate failed (${result.status}): ${JSON.stringify(result.body)}`,
    );
  }
  return result.body as TastingDay;
}

/**
 * A trace carrying a hand-built tasting context over two real pool
 * places. The fact values are synthetic and never leave this function —
 * only their digests are stored, exactly as a real generation does.
 */
async function syntheticTrace(
  client: SupabaseClient,
): Promise<{ traceId: string; cards: Card[] }> {
  const { data: places, error } = await client
    .from("places")
    .select("id, name")
    .eq("city", "toronto")
    .eq("source", "fsq_os_places")
    .order("id")
    .limit(2);
  if (error) throw new Error(`pool read failed: ${error.message}`);
  if ((places ?? []).length < 2) throw new Error("pool has fewer than 2 places");

  const hours = {
    monday: [{ open: "09:00", close: "17:00" }],
    saturday: [{ open: "10:00", close: "18:00" }],
  };
  const price = { min: 15, max: 40, currency: "CAD" };
  const shown = (value: unknown, source: string, tier: number) => ({
    status: "present",
    source,
    tier,
    fetched_at: new Date().toISOString(),
    digest: factDigest(value as never),
  });

  const cards = places!.map((p, i) => ({
    slotId: `s-i${i + 1}`,
    placeId: p.id as string,
    name: p.name as string,
  }));

  const { data, error: traceError } = await client
    .from("traces")
    .insert({
      kind: "day_generation",
      metadata: {
        surface: "tasting_room",
        proof: "synthetic-context",
        tasting: {
          surface: "tasting_room",
          persona_key: PERSONA,
          day_date: DATE,
          cards: Object.fromEntries(
            cards.map((c) => [
              c.slotId,
              {
                place_id: c.placeId,
                facts: {
                  hours: shown(hours, "google_places", 1),
                  price_range: shown(price, "google_places", 2),
                  business_status: shown("operational", "google_places", 1),
                },
                rule_ids: ["hours.unknown"],
              },
            ]),
          ),
        },
      },
    })
    .select("id")
    .single();
  if (traceError) throw new Error(`synthetic trace failed: ${traceError.message}`);
  return { traceId: data.id as string, cards };
}

/** A reporter at the named rung, created once and reused across runs. */
async function ensureReporter(
  client: SupabaseClient,
  handle: string,
  authority: "trusted" | "user",
  founderId: string,
): Promise<void> {
  const { data } = await client
    .from("reporters")
    .select("id")
    .eq("handle", handle)
    .maybeSingle();
  if (data !== null) return;
  // Appointment is audited for 'trusted' and forbidden for 'user' —
  // reporters_grant_audited enforces the pairing either way.
  const row: Record<string, string | null> = { handle, authority };
  if (authority === "trusted") {
    row.granted_by = founderId;
    row.granted_at = new Date().toISOString();
  }
  const { error } = await client.from("reporters").insert(row);
  if (error) throw new Error(`reporter seed failed: ${error.message}`);
}

async function main() {
  const client = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const secret = requireEnv("TASTING_ROOM_SECRET");

  line(
    `tasting-proof: base=${BASE} mode=${SYNTHETIC ? "synthetic" : "live"} ` +
      `persona=${PERSONA} date=${DATE} seed=${SEED}`,
  );

  // ---------------------------------------------------------------------
  head("(e) unauthenticated route: 401, nothing leaked");
  const tracesBeforeGate = await client
    .from("traces")
    .select("id", { count: "exact" })
    .eq("kind", "day_generation")
    .limit(1);
  const noSecret = await post("/api/tasting/generate", {
    personaKey: PERSONA,
    date: DATE,
  });
  check("status is 401", noSecret.status === 401, `got ${noSecret.status}`);
  check(
    "body carries only an error",
    JSON.stringify(noSecret.body) === '{"error":"unauthorized"}',
    JSON.stringify(noSecret.body),
  );
  const badSecret = await post(
    "/api/tasting/generate",
    { personaKey: PERSONA, date: DATE },
    { "x-tasting-secret": "wrong" },
  );
  check("a wrong secret is also 401", badSecret.status === 401);
  const noSecretEvidence = await post("/api/tasting/evidence", {
    traceId: "00000000-0000-0000-0000-000000000000",
    slotId: "s-i1",
    claim: "hours_wrong",
  });
  check("the evidence route is gated too", noSecretEvidence.status === 401);
  const noSecretTaste = await post("/api/tasting/taste", {
    traceId: "00000000-0000-0000-0000-000000000000",
    signal: "day_verdict",
  });
  check("the taste route is gated too", noSecretTaste.status === 401);
  const tracesAfterGate = await client
    .from("traces")
    .select("id", { count: "exact" })
    .eq("kind", "day_generation")
    .limit(1);
  check(
    "a refused request caused no database work at all",
    tracesBeforeGate.count === tracesAfterGate.count,
    `${tracesBeforeGate.count} → ${tracesAfterGate.count} traces`,
  );

  // ---------------------------------------------------------------------
  head("(a) founder ✗ → tier-1 evidence → fact flip");
  let traceId: string;
  let cards: Card[];
  let before: TastingDay | null = null;

  if (SYNTHETIC) {
    const built = await syntheticTrace(client);
    traceId = built.traceId;
    cards = built.cards;
    line(`  synthetic trace ${traceId} over real pool places (no Google calls)`);
  } else {
    before = await generate(secret);
    traceId = before.meter.traceId;
    line(
      `  generation 1: trace ${traceId} · $${before.meter.estCostUsd.toFixed(3)} · ` +
        `${before.meter.totalMs}ms · overrides ${before.meter.founderOverrides}`,
    );
    cards = before.day.slots
      .filter((s) => s.origin === "concierge")
      .map((s) => ({
        slotId: s.id,
        placeId: s.placeId,
        name: before!.day.places[s.placeId].name,
      }));
  }
  // Which cards actually had a fact on screen? A candidate with no Google
  // link is shown with hours/status never fetched — and a founder report
  // is MOST valuable exactly there ("I walked past, it is shut"). Both
  // paths get proved: the digest path on a card that showed a fact, the
  // honest-null path on one that showed none.
  const { data: traceRow } = await client
    .from("traces")
    .select("metadata")
    .eq("id", traceId)
    .single();
  const contextCards =
    ((traceRow?.metadata as { tasting?: { cards?: Record<string, { facts: Record<string, unknown> }> } })
      ?.tasting?.cards) ?? {};
  const showedFact = (slotId: string): boolean =>
    Object.keys(contextCards[slotId]?.facts ?? {}).length > 0;

  const target = cards.find((c) => showedFact(c.slotId)) ?? cards[0];
  const other =
    cards.find((c) => c.slotId !== target.slotId) ?? cards[0];
  const blind = cards.find((c) => !showedFact(c.slotId)) ?? null;
  line(`  target card: ${target.slotId} → ${target.name} (${target.placeId})`);

  const flip = await post(
    "/api/tasting/evidence",
    {
      traceId,
      slotId: target.slotId,
      claim: "permanently_closed",
      freeText:
        "HARNESS ARTIFACT (scripts/tasting-proof.ts) — not a real founder observation.",
    },
    { "x-tasting-secret": secret },
  );
  check("evidence accepted", flip.status === 200, JSON.stringify(flip.body));
  const flipBody = flip.body as {
    evidenceId: string;
    authority: string;
    verificationState: string;
    flippedFactKey: string | null;
  };
  check("authority is founder", flipBody.authority === "founder");
  check(
    "founder authority bypasses verification",
    flipBody.verificationState === "bypassed",
  );
  check("it flipped business_status", flipBody.flippedFactKey === "business_status");

  const { data: evidenceRow } = await client
    .from("evidence")
    .select(
      "reporter_authority, claim, fact_key, shown_source, shown_tier, shown_status, shown_digest, flip_fact_key, flip_value, flipped_at, persona_key, day_date, adjacent_rule_ids",
    )
    .eq("id", flipBody.evidenceId)
    .single();
  line(`  evidence row: ${JSON.stringify(evidenceRow)}`);
  check("the claim names the disputed fact", evidenceRow?.fact_key === "business_status");
  check("what was shown is recorded", evidenceRow?.shown_source !== null);
  check(
    "the shown value is fingerprinted, not stored",
    typeof evidenceRow?.shown_digest === "string" &&
      /^[0-9a-f]{64}$/.test(evidenceRow.shown_digest as string),
  );
  check(
    "the shown block is all-or-nothing",
    (evidenceRow?.shown_source === null) === (evidenceRow?.shown_digest === null),
  );
  check("the flip is audited on the row", evidenceRow?.flipped_at !== null);
  check(
    "the corpus is keyed by persona, date and rule-adjacency",
    evidenceRow?.persona_key === PERSONA &&
      evidenceRow?.day_date === DATE &&
      Array.isArray(evidenceRow?.adjacent_rule_ids),
  );

  const { data: factRow } = await client
    .from("facts")
    .select("fact_key, status, value, source, tier, fetched_at")
    .eq("place_id", target.placeId)
    .eq("fact_key", "business_status")
    .maybeSingle();
  line(`  founder fact:  ${JSON.stringify(factRow)}`);
  check("a tier-1 founder fact exists", factRow?.tier === 1);
  check("through the founder channel", factRow?.source === "founder_groundtruth");
  check("saying closed_permanently", factRow?.value === "closed_permanently");

  if (!SYNTHETIC) {
    const after = await generate(secret);
    line(
      `  generation 2: trace ${after.meter.traceId} · $${after.meter.estCostUsd.toFixed(3)} · ` +
        `${after.meter.totalMs}ms · overrides ${after.meter.founderOverrides}`,
    );
    check(
      "the flipped venue is gone from the new day",
      !after.day.slots.some((s) => s.placeId === target.placeId),
      target.name,
    );
    check(
      "the trace records the override governing",
      after.meter.founderOverrides >= 1,
      `founderOverrides=${after.meter.founderOverrides}`,
    );
    const { data: overrideEvents } = await client
      .from("trace_events")
      .select("endpoint, metadata")
      .eq("trace_id", after.meter.traceId)
      .eq("provider", "founder_groundtruth");
    line(`  override events: ${JSON.stringify(overrideEvents)}`);
  } else {
    line(
      "  NOT SHOWN in synthetic mode: the second half of (a) — a regeneration\n" +
        "  governed by the flipped fact. It needs Google Details quota. The\n" +
        "  override reaching hardFilter is covered by Tier-1 fixtures\n" +
        "  (tests/founder-groundtruth.test.ts); the live half is deferred.",
    );
  }

  if (blind !== null) {
    head("(a2) a claim against a card that showed nothing");
    line(
      `  ${blind.slotId} → ${blind.name}: no Google link, so hours and status were never fetched.`,
    );
    const blindClaim = await post(
      "/api/tasting/evidence",
      {
        traceId,
        slotId: blind.slotId,
        claim: "permanently_closed",
        freeText: "HARNESS ARTIFACT — report against an unverified card.",
      },
      { "x-tasting-secret": secret },
    );
    check("accepted", blindClaim.status === 200, JSON.stringify(blindClaim.body));
    const { data: blindRow } = await client
      .from("evidence")
      .select("shown_status, shown_source, shown_tier, shown_digest, flip_fact_key")
      .eq("id", (blindClaim.body as { evidenceId: string }).evidenceId)
      .single();
    line(`  evidence row: ${JSON.stringify(blindRow)}`);
    check(
      "the row says nothing was shown, rather than guessing",
      blindRow?.shown_status === null &&
        blindRow?.shown_source === null &&
        blindRow?.shown_digest === null,
    );
    check(
      "and the founder claim still flips the fact",
      blindRow?.flip_fact_key === "business_status",
    );
    // Undo immediately: this one is not the headline proof.
    await client
      .from("facts")
      .delete()
      .eq("place_id", blind.placeId)
      .eq("fact_key", "business_status")
      .eq("source", "founder_groundtruth");
  }

  // ---------------------------------------------------------------------
  head("(b)(c) simulated user and trusted reports flip nothing");
  const { data: founder } = await client
    .from("reporters")
    .select("id")
    .eq("handle", "founder")
    .single();
  await ensureReporter(client, "sim_user", "user", founder!.id);
  await ensureReporter(client, "sim_trusted", "trusted", founder!.id);
  const { data: trustedRow } = await client
    .from("reporters")
    .select("handle, authority, granted_by, granted_at")
    .eq("handle", "sim_trusted")
    .single();
  line(`  trusted appointment audit: ${JSON.stringify(trustedRow)}`);
  check(
    "a trusted rung records who granted it and when",
    trustedRow?.granted_by !== null && trustedRow?.granted_at !== null,
  );

  for (const [handle, expectedState] of [
    ["sim_user", "not_queued"],
    ["sim_trusted", "queued"],
  ] as const) {
    const result = await post(
      "/api/tasting/evidence",
      {
        traceId,
        slotId: other.slotId,
        claim: "permanently_closed",
        freeText: `HARNESS ARTIFACT — simulated ${handle} report`,
      },
      { "x-tasting-secret": secret, "x-tasting-reporter": handle },
    );
    const body = result.body as {
      authority: string;
      verificationState: string;
      flippedFactKey: string | null;
    };
    line(`  ${handle}: ${JSON.stringify(body)}`);
    check(`${handle} recorded`, result.status === 200);
    check(
      `${handle} verification state is ${expectedState}`,
      body.verificationState === expectedState,
    );
    check(`${handle} flipped nothing`, body.flippedFactKey === null);
  }

  const { data: contaminating } = await client
    .from("facts")
    .select("place_id")
    .eq("place_id", other.placeId)
    .eq("source", "founder_groundtruth");
  check(
    "no founder fact exists for the non-founder-reported place",
    (contaminating ?? []).length === 0,
    `${(contaminating ?? []).length} rows`,
  );

  // The database itself refuses a non-founder flip, not just the code.
  const { error: checkViolation } = await client.from("evidence").insert({
    place_id: other.placeId,
    claim: "permanently_closed",
    fact_key: "business_status",
    reporter_id: founder!.id,
    reporter_authority: "user",
    verification_state: "not_queued",
    flip_fact_key: "business_status",
    flip_value: "closed_permanently",
    flipped_at: new Date().toISOString(),
  });
  check(
    "the DB rejects a non-founder row claiming a flip",
    checkViolation !== null &&
      checkViolation.message.includes("evidence_only_founder_flips"),
    checkViolation?.message ?? "INSERT SUCCEEDED — the invariant is not enforced",
  );

  // ---------------------------------------------------------------------
  head("(d) 'not for me' lands in taste and never in evidence");
  const evidenceBefore = await client
    .from("evidence")
    .select("id", { count: "exact" })
    .eq("trace_id", traceId)
    .limit(1);
  const taste = await post(
    "/api/tasting/taste",
    {
      traceId,
      slotId: other.slotId,
      signal: "not_for_me",
      freeText: "Right pick, wrong vibe for this persona.",
    },
    { "x-tasting-secret": secret },
  );
  check("taste signal accepted", taste.status === 200, JSON.stringify(taste.body));
  const dayVerdict = await post(
    "/api/tasting/taste",
    {
      traceId,
      signal: "day_verdict",
      freeText: "Morning perfect, evening felt like a brochure.",
    },
    { "x-tasting-secret": secret },
  );
  check("day verdict accepted", dayVerdict.status === 200);

  const evidenceAfter = await client
    .from("evidence")
    .select("id", { count: "exact" })
    .eq("trace_id", traceId)
    .limit(1);
  check(
    "no evidence row was created by either taste write",
    evidenceBefore.count === evidenceAfter.count,
    `${evidenceBefore.count} → ${evidenceAfter.count}`,
  );
  const { data: tasteRows } = await client
    .from("taste_signals")
    .select("signal, place_id, slot_id, free_text, reporter_authority")
    .eq("trace_id", traceId);
  line(`  taste rows: ${JSON.stringify(tasteRows)}`);
  check(
    "the day verdict carries no place and no card",
    (tasteRows ?? []).some(
      (r) => r.signal === "day_verdict" && r.place_id === null && r.slot_id === null,
    ),
  );

  const crossed = await post(
    "/api/tasting/evidence",
    { traceId, slotId: other.slotId, claim: "not_for_me" },
    { "x-tasting-secret": secret },
  );
  check(
    "a taste signal is not a spellable evidence claim",
    crossed.status === 400,
    `got ${crossed.status}`,
  );
  const crossedBack = await post(
    "/api/tasting/taste",
    { traceId, slotId: other.slotId, signal: "hours_wrong" },
    { "x-tasting-secret": secret },
  );
  check(
    "an evidence claim is not a spellable taste signal",
    crossedBack.status === 400,
    `got ${crossedBack.status}`,
  );

  // ---------------------------------------------------------------------
  head("(f) the per-day self-cap refuses");
  const synthetic = Array.from({ length: 12 }, () => ({
    kind: "day_generation",
    metadata: { surface: "tasting_room", proof: "self-cap-refusal" },
  }));
  const { data: inserted, error: insertError } = await client
    .from("traces")
    .insert(synthetic)
    .select("id");
  if (insertError) throw new Error(`cap proof setup failed: ${insertError.message}`);
  try {
    const capped = await post(
      "/api/tasting/generate",
      { personaKey: PERSONA, date: DATE, budgetMax: null, seed: SEED },
      { "x-tasting-secret": secret },
    );
    line(`  response: ${capped.status} ${JSON.stringify(capped.body)}`);
    check("status is 429", capped.status === 429);
    const body = capped.body as {
      status?: string;
      quota?: { dailyCap: number; generationsToday: number };
    };
    check("the refusal names the cap", body.quota?.dailyCap === 12);
    check("and it is not a silent no-op", body.status === "capped");
    check(
      "the refusal spent nothing",
      (body.quota?.generationsToday ?? 0) >= 12,
    );
  } finally {
    const ids = (inserted ?? []).map((r) => r.id);
    const { error: cleanupError } = await client.from("traces").delete().in("id", ids);
    line(
      cleanupError
        ? `  CLEANUP FAILED for ${ids.length} synthetic traces: ${cleanupError.message}`
        : `  cleaned up ${ids.length} synthetic traces`,
    );
  }

  // ---------------------------------------------------------------------
  head("cleanup");
  if (has("--keep-flip")) {
    line(`  --keep-flip: the founder fact on ${target.name} STAYS in production.`);
  } else {
    const { error } = await client
      .from("facts")
      .delete()
      .eq("place_id", target.placeId)
      .eq("fact_key", "business_status")
      .eq("source", "founder_groundtruth");
    line(
      error
        ? `  FAILED to remove the harness founder fact: ${error.message}`
        : `  removed the harness founder fact on ${target.name} — production carries no fabricated closure.`,
    );
    if (error) failures++;
  }

  head("summary");
  if (before !== null) {
    line(
      `  quota: ${before.meter.quota.generationsToday}/${before.meter.quota.dailyCap} generations today · ` +
        `${before.meter.quota.detailsThisMonth}/${before.meter.quota.detailsFreeCap} Details events this month`,
    );
  }
  line(failures === 0 ? "\n  ALL CHECKS PASSED" : `\n  ${failures} CHECK(S) FAILED`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
