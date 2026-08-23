/**
 * Retrieval — candidate pull from the base-layer pool (CP1 §1.1 stage 1).
 *
 * Query shape (per category, run concurrently): `places` rows for the
 * city joined through the `categories` fact, bounded by the day-zone
 * bbox, deterministic `fsq_place_id` order, capped per category. The cap
 * is a coverage trade recorded honestly: within a zone bbox it favors a
 * stable arbitrary subset over an unbounded scan; determinism (same
 * request → same candidates) is worth more to this engine than tail
 * coverage, and the cap is generous relative to shortlist size.
 *
 * Zone vocabulary is Session 4's nine hand-set neighborhood anchors. A
 * candidate's `neighborhood` label is the nearest zone anchor measured
 * from FSQ coordinates — our Apache-licensed data, not Google's, so the
 * point-in-polygon prohibition (001 §3.2.3(c)(iv)) is not in play.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { drinkingFocusOf } from "@/shared/constraints";
import { cuisinesFromLabels } from "@/shared/cuisine";
import { haversineKm } from "@/shared/day-grammar/travel";
import type { GrammarFact, LatLng } from "@/shared/day-grammar/types";
import type { Lens } from "@/shared/persona";
import { isOutdoorCategory, type PlaceCategory } from "@/shared/vocabulary";
import { weightedOrderBy } from "@/shared/dice";
import { THEME_ZONES } from "@/shared/theme";
import { ANCHORS, type Anchor } from "../discovery/plan";
import { COMPOSE_PARAMS } from "./compose-params";
import type { Candidate } from "./types";

const PER_CATEGORY_CAP = 400;
/**
 * How far past a DISCOVERY anchor's own radius a candidate may sit.
 *
 * It exists because Session 4's nine anchors are approximations of
 * neighbourhoods — a point and a radius standing in for a shape — so a venue
 * just outside the circle is usually still in the neighbourhood.
 *
 * A THEME ZONE is not an approximation. It is drawn for one purpose against
 * measured coordinates, and the slack actively harms it: the first live
 * islands generation retrieved **St. James Park**, 3.3 km away on the
 * mainland, because 2.5 km of radius plus 1.0 km of slack reaches across the
 * harbour. The day then seated a mainland park as its island centre.
 *
 * So the slack is a property of the ZONE, not a constant of retrieval.
 */
const ZONE_SLACK_KM = 1.0;

/**
 * A zone as retrieval sees it: a discovery anchor, optionally with its own
 * reach. `slackKm: 0` means "this circle is the answer, not an estimate".
 */
export type RetrievalZone = Anchor & { slackKm?: number };

const slackOf = (zone: RetrievalZone): number => zone.slackKm ?? ZONE_SLACK_KM;

/**
 * The smallest zone set a day is still composed from. Below this the bbox
 * stops holding enough venues to seat a full arc — found by losing a close
 * (XXX-35, Session 12 CP2).
 */
const MIN_ZONES_FOR_A_DAY = 4;

const ICON_ZONES = new Set([
  "downtown_core",
  "st_lawrence",
  "distillery",
  "waterfront",
  "yorkville",
]);
const CORNER_ZONES = new Set([
  "kensington_chinatown",
  "queen_west_ossington",
  "annex",
  "leslieville",
]);

/**
 * The zone anchors a day draws from — lens-driven, anchor-overridden, and
 * (Session 12) diced WITHIN the lens's bucket.
 *
 * The lens still decides which bucket: an icons persona never draws a corners
 * zone. What the dice decides is the day's EMPHASIS inside it, because
 * keying zone choice on `lens` alone meant every icons persona on every date
 * searched the same five neighbourhoods — a variety ceiling upstream of every
 * selector below it.
 *
 * Cost-neutral by construction, not by discipline: zone choice only sets the
 * bbox, and `retrieveCandidates` issues one query per CATEGORY regardless of
 * how wide that box is. Passing no `dice` keeps the full bucket, which is
 * what a user-anchored day and the fixture tests want.
 */
export function zonesFor(
  lens: Lens,
  anchorCoords: LatLng[],
  dice?: () => number,
  /**
   * Zone slugs the DAY'S THEME asks for (XXX-40, Session 14 CP0 ruling 2).
   *
   * **A theme has a geography, and the persona's lens is not it.** An
   * experience day is defined by the place it goes to; the lens describes how
   * a traveller likes to see a CITY. Session 14 CP0 measured what that cost:
   * golden Day 7's persona is `corners`, whose bucket is Kensington / Queen
   * West / Annex / Leslieville, and the Toronto Islands are not reachable
   * from any of them at any seed. 94 island identities sat in the pool and
   * the engine could not retrieve one.
   *
   * So a theme uses the same door a USER ANCHOR already uses — the branch
   * below — and for the same reason: a committed day is a geographic fact
   * that outranks a stylistic preference.
   *
   * Precedence, stated once: **user anchors > theme zones > lens bucket.**
   * The lens remains the themeless default.
   */
  themeZoneSlugs: readonly string[] = [],
): RetrievalZone[] {
  if (themeZoneSlugs.length > 0 && anchorCoords.length === 0) {
    const zones = THEME_ZONES.filter((z) => themeZoneSlugs.includes(z.slug));
    // An unknown slug is a typo in a spec, not a reason to silently hand back
    // the lens's zones and generate a mainland day under an island theme.
    if (zones.length !== themeZoneSlugs.length) {
      throw new Error(
        `unknown theme zone(s): ${themeZoneSlugs
          .filter((s) => !THEME_ZONES.some((z) => z.slug === s))
          .join(", ")}`,
      );
    }
    // A theme zone carries NO discovery slack: it is a hand-drawn circle for
    // one purpose, and the extra kilometre reaches across the harbour.
    return zones.map((z) => ({ ...z, slackKm: 0 }));
  }
  if (anchorCoords.length > 0) {
    // A committed day is a geographic fact: draw from every zone within
    // reach of any user anchor, whatever the lens says.
    return ANCHORS.filter((zone) =>
      anchorCoords.some(
        (a) => haversineKm(a, { lat: zone.lat, lng: zone.lng }) <= 3.0,
      ),
    );
  }
  const bucket =
    lens === "icons"
      ? ANCHORS.filter((z) => ICON_ZONES.has(z.slug))
      : lens === "corners"
        ? ANCHORS.filter((z) => CORNER_ZONES.has(z.slug))
        : [...ANCHORS];
  if (dice === undefined) return bucket;

  // Every zone in the bucket is equally on-lens, so this is a flat draw
  // rather than a weighted one — dressing it as weighted would be false
  // precision.
  //
  // Exactly ONE zone is dropped, and only from a bucket that can spare it.
  // The first cut took a fraction of the bucket, which read fine against the
  // 5-zone `icons` list and quietly broke `corners`: at 4 zones it dropped a
  // quarter of the day's geography, and `day-4-budget` lost its close because
  // the bars that could seat it lived in the dropped zone. Measured, not
  // reasoned — restoring the full bucket restored the close.
  //
  // The trade is stated rather than hidden: a `corners` persona gets no zone
  // variety at all. Its distinctiveness comes from the category dice and the
  // pool-window rotation instead, and a day that cannot be composed is worth
  // less than a day that searched the same four neighbourhoods as its twin.
  if (bucket.length <= MIN_ZONES_FOR_A_DAY) return bucket;
  const keep = bucket.length - 1;
  const drawn = weightedOrderBy(
    bucket,
    () => 0,
    dice,
    COMPOSE_PARAMS.dice.zone,
  ).slice(0, keep);
  // Restored to the canonical ANCHORS order so the bbox and every downstream
  // `nearestZone` read the same list regardless of what the dice returned.
  return ANCHORS.filter((z) => drawn.includes(z));
}

/**
 * The stable orderings a pool page may be taken in.
 *
 * `.order(fsq_place_id).limit(400)` returned the SAME 400 rows for every
 * persona on every run — a fixed slice of a pool that is often far larger, so
 * the tail was structurally unreachable no matter how well the dice below it
 * worked. Rotating the order key gives eight deterministic windows at
 * identical cost: same query count, same volume, different 400 rows.
 *
 * Labelled honestly, per the CP1 ruling: this is ROTATION, not uniform
 * coverage. Eight reachable slices is eight, not a sample. The real fix is
 * the pre-fetch popularity signal XXX-31 owes the pool, and it is explicitly
 * not this ticket.
 */
export const POOL_WINDOWS: readonly { column: string; ascending: boolean }[] = [
  { column: "fsq_place_id", ascending: true },
  { column: "fsq_place_id", ascending: false },
  { column: "id", ascending: true },
  { column: "id", ascending: false },
  { column: "lat", ascending: true },
  { column: "lat", ascending: false },
  { column: "lng", ascending: true },
  { column: "lng", ascending: false },
];

function bboxOf(zones: RetrievalZone[]): {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
} {
  const kmPerDegLat = 110.574;
  let latMin = 90;
  let latMax = -90;
  let lngMin = 180;
  let lngMax = -180;
  for (const z of zones) {
    const reachKm = z.radiusM / 1000 + slackOf(z);
    const dLat = reachKm / kmPerDegLat;
    const dLng = reachKm / (111.32 * Math.cos((z.lat * Math.PI) / 180));
    latMin = Math.min(latMin, z.lat - dLat);
    latMax = Math.max(latMax, z.lat + dLat);
    lngMin = Math.min(lngMin, z.lng - dLng);
    lngMax = Math.max(lngMax, z.lng + dLng);
  }
  return { latMin, latMax, lngMin, lngMax };
}

/**
 * The joined `categories` fact, as the row actually carries it.
 *
 * `value` is external input and typed as unknown-ish on purpose: it is
 * whatever the database holds, and `sourceLabelsOf` narrows it rather than
 * trusting it.
 */
interface PoolFactRow {
  fact_key: string;
  value: { mapped?: unknown; source_labels?: unknown } | null;
}

/**
 * One pooled place, as `select()` above actually returns it.
 *
 * `facts` was MISSING from this interface until Session 15, while the query
 * has always joined it — so `(data ?? []) as unknown as PoolRow[]` was a
 * double assertion that erased a field the row really had. Nothing
 * downstream could see `source_labels`, which is where every cuisine in the
 * pool lives. The cast now asserts something true.
 */
interface PoolRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
  google_place_id: string | null;
  fsq_place_id: string | null;
  source: string;
  tier: number;
  fetched_at: string;
  facts: PoolFactRow[] | null;
}

/**
 * The raw taxonomy labels for a row, or none.
 *
 * Never throws: a malformed `value` means we do not know this venue's
 * cuisine, which is honest absence, not a reason to fail a generation. A
 * venue with no labels is simply never cuisine-matched and is never
 * penalised for it.
 */
function sourceLabelsOf(row: PoolRow): string[] {
  const fact = row.facts?.find((f) => f.fact_key === "categories");
  const labels = fact?.value?.source_labels;
  if (!Array.isArray(labels)) return [];
  return labels.filter((l): l is string => typeof l === "string");
}

function nearestZone(
  zones: readonly RetrievalZone[],
  coords: LatLng,
): RetrievalZone | null {
  let best: RetrievalZone | null = null;
  let bestKm = Infinity;
  for (const z of zones) {
    const km = haversineKm(coords, { lat: z.lat, lng: z.lng });
    if (km < bestKm) {
      best = z;
      bestKm = km;
    }
  }
  return best !== null && bestKm <= best.radiusM / 1000 + slackOf(best)
    ? best
    : null;
}

export async function retrieveCandidates(
  client: SupabaseClient,
  city: string,
  categories: PlaceCategory[],
  zones: RetrievalZone[],
  /**
   * Picks which of `POOL_WINDOWS` this request pages by. Omit for the
   * canonical `fsq_place_id` ascending window — what the fixtures and any
   * caller wanting the historical slice should use.
   */
  window?: (category: PlaceCategory) => number,
): Promise<Candidate[]> {
  const box = bboxOf(zones);

  const perCategory = await Promise.all(
    categories.map(async (category) => {
      const order =
        POOL_WINDOWS[
          window === undefined ? 0 : window(category) % POOL_WINDOWS.length
        ];
      const { data, error } = await client
        .from("places")
        .select(
          "id, name, lat, lng, google_place_id, fsq_place_id, source, tier, fetched_at, facts!inner(fact_key, value)",
        )
        .eq("city", city)
        .eq("source", "fsq_os_places")
        .eq("facts.fact_key", "categories")
        .filter("facts.value->mapped", "cs", JSON.stringify([category]))
        .gte("lat", box.latMin)
        .lte("lat", box.latMax)
        .gte("lng", box.lngMin)
        .lte("lng", box.lngMax)
        .order(order.column, { ascending: order.ascending })
        .limit(PER_CATEGORY_CAP);
      if (error) {
        throw new Error(`candidate retrieval failed: ${error.message}`);
      }
      return { category, rows: (data ?? []) as unknown as PoolRow[] };
      // NOTE: the assertion stays (Supabase's inferred join type is wider
      // than the row we select), but `PoolRow` now describes every field the
      // query returns, so it no longer erases one.
    }),
  );

  const candidates: Candidate[] = [];
  for (const { category, rows } of perCategory) {
    for (const row of rows) {
      const coords = { lat: row.lat, lng: row.lng };
      const zone = nearestZone(zones, coords);
      if (zone === null) continue; // inside the bbox but outside every circle
      /**
       * The LABEL is the venue's own neighbourhood, never the admitting
       * zone's name (XXX-40, Session 14 Step 3 ruling 2).
       *
       * A theme day draws from ONE zone, so labelling by the admitting zone
       * made every venue read "· Toronto Islands" — including a mainland
       * waterfront LCBO the traveller visits before the ferry, which is a
       * correct stop wearing a wrong address.
       *
       * Discovery anchors are what neighbourhoods are FOR, so the label comes
       * from the nearest of those. A venue genuinely out on the islands
       * matches no mainland anchor and keeps the theme zone's label, which is
       * then the true answer rather than a default.
       */
      const labelZone = nearestZone(ANCHORS, coords) ?? zone;
      const categoryFact: GrammarFact<PlaceCategory> = {
        status: "present",
        value: category,
        source: row.source,
        tier: 2,
        fetchedAt: row.fetched_at,
      };
      /**
       * The drinking-focus fact, read from the SAME labels the category and
       * the cuisine already come from (XXX-44, Session 16). One join, three
       * derivations — no new query, no re-ingest, no Google call.
       *
       * `domain/schemas.ts` types `source_labels` as `.nonempty()`, so a
       * pooled row that reached here has labels and the fact is present. The
       * `absent` branch is not dead defensiveness: `sourceLabelsOf` returns
       * `[]` for a malformed `value` too, and a malformed record is exactly
       * the case that must say "we do not know" rather than "not a bar".
       */
      const labels = sourceLabelsOf(row);
      const focus = drinkingFocusOf(labels);
      const drinkingFact: GrammarFact<boolean> =
        focus === "unknown"
          ? {
              status: "absent",
              source: row.source,
              tier: 2,
              fetchedAt: row.fetched_at,
            }
          : {
              status: "present",
              value: focus === "focused",
              source: row.source,
              tier: 2,
              fetchedAt: row.fetched_at,
            };
      candidates.push({
        place: {
          id: row.id,
          name: row.name,
          neighborhood: labelZone.label,
          coords,
          /**
           * `outdoor` derives from the FAMILY, never from a category literal
           * (XXX-40, Session 14 CP0). It read `category === "parks"` — true
           * when `parks` was the only outdoor category, wrong the moment
           * `scenic_viewpoints` joined the family in Session 13, and silent
           * about it because a `false` here does not fail anything: it just
           * removes the place from every daylight and weather rule's sight.
           */
          tags: {
            outdoor: isOutdoorCategory(category),
            goldenHourAffine: false,
            highCrowd: false,
          },
          category: categoryFact,
          drinkingFocused: drinkingFact,
        },
        category,
        /**
         * Cuisine rides the CANDIDATE, not the place — the same division
         * `rating` follows, and for the same reason: no grammar rule reads
         * it. Cuisine is a preference input to scoring and to the selection
         * menu, never a claim about the day's validity.
         *
         * A venue with no cuisine label gets `[]`, which scores neutral. We
         * are ignorant of its kitchen, and ignorance is not a demerit.
         */
        cuisines: cuisinesFromLabels(labels),
        googlePlaceId: row.google_place_id,
        rating: null,
        userRatingCount: null,
        detailsFetched: false,
        score: 0,
      });
    }
  }
  return candidates;
}
