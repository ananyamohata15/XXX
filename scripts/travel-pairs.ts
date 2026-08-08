import type { LatLng } from "../src/shared/day-grammar/types";
import type { TransportMode } from "../src/shared/vocabulary";
import type { OrsMode } from "../src/server/travel/ors";

/**
 * The Session 8 probe universe (XXX-24 Step 3): golden-set places, the
 * directed pairs whose ORS times get stored, the founder's lived
 * estimates from golden-set v2 (tier-1 seed rows), and the probe
 * queries compared against them at CHECKPOINT 3.
 *
 * Coordinates are the golden fixtures' authored values, verbatim — the
 * matrix is keyed on exact coordinates (MatrixTravelProvider.key), so
 * consumers must query with the same literals the matrix was built
 * from. The fixtures are the single source of those literals.
 */

export const CITY = "toronto";

export interface ProbePlace {
  key: string;
  label: string;
  coords: LatLng;
}

const place = (key: string, label: string, lat: number, lng: number) =>
  [key, { key, label, coords: { lat, lng } }] as const;

export const PLACES: Record<string, ProbePlace> = Object.fromEntries([
  // City (golden days 1–5)
  place("kensington", "FIKA Cafe, Kensington", 43.6545, -79.4008),
  place("graffiti-alley", "Graffiti Alley", 43.6479, -79.399),
  place("harbourfront", "Harbourfront Centre", 43.6387, -79.3816),
  place("roundhouse", "Roundhouse Park (Steam Whistle)", 43.6414, -79.3861),
  place("rogers-centre", "Rogers Centre", 43.6414, -79.3894),
  place("st-lawrence-market", "St. Lawrence Market", 43.6488, -79.3715),
  place("distillery", "Distillery District", 43.6503, -79.3596),
  place("rom", "Royal Ontario Museum", 43.6677, -79.3948),
  place("nathan-phillips", "Nathan Phillips Square", 43.6525, -79.3839),
  place("trinity-bellwoods", "Trinity Bellwoods Park", 43.647, -79.413),
  // Day-6 corridor (Nathan Phillips stands in for "downtown Toronto")
  place("beamsville", "Beamsville bench (tasting stop)", 43.165, -79.475),
  place("nol-old-town", "Niagara-on-the-Lake old town", 43.2557, -79.0715),
  place("nol-winery", "NOL winery lunch", 43.234, -79.068),
  place("falls", "Niagara Falls (Table Rock)", 43.079, -79.0783),
]);

/** Location sets for the ORS Matrix calls (one call per profile). */
export const CITY_MATRIX_KEYS = [
  "kensington",
  "graffiti-alley",
  "harbourfront",
  "roundhouse",
  "rogers-centre",
  "st-lawrence-market",
  "distillery",
  "rom",
  "nathan-phillips",
  "trinity-bellwoods",
] as const;

export const CORRIDOR_MATRIX_KEYS = [
  "nathan-phillips",
  "beamsville",
  "nol-old-town",
  "nol-winery",
  "falls",
] as const;

export interface StoredPairSpec {
  origin: string;
  dest: string;
  modes: readonly OrsMode[];
  /** Which matrix call the cells come from. */
  set: "city" | "corridor";
}

/**
 * The directed pairs whose ORS answers are stored. 12 distinct pairs —
 * two orders of magnitude inside doc 003's 1,000/city ceiling.
 */
export const STORED_PAIRS: readonly StoredPairSpec[] = [
  { origin: "kensington", dest: "graffiti-alley", modes: ["walk", "cycle"], set: "city" },
  { origin: "graffiti-alley", dest: "harbourfront", modes: ["walk", "cycle"], set: "city" },
  { origin: "harbourfront", dest: "roundhouse", modes: ["walk", "cycle"], set: "city" },
  { origin: "kensington", dest: "rom", modes: ["walk", "cycle"], set: "city" },
  { origin: "st-lawrence-market", dest: "distillery", modes: ["walk", "cycle"], set: "city" },
  { origin: "rom", dest: "nathan-phillips", modes: ["walk", "cycle"], set: "city" },
  { origin: "nathan-phillips", dest: "rogers-centre", modes: ["walk", "cycle", "drive"], set: "city" },
  { origin: "kensington", dest: "trinity-bellwoods", modes: ["walk", "cycle"], set: "city" },
  { origin: "nathan-phillips", dest: "beamsville", modes: ["drive"], set: "corridor" },
  { origin: "beamsville", dest: "nol-old-town", modes: ["drive"], set: "corridor" },
  { origin: "nol-winery", dest: "falls", modes: ["drive"], set: "corridor" },
  { origin: "falls", dest: "nathan-phillips", modes: ["drive"], set: "corridor" },
];

export interface FounderSeed {
  origin: string;
  dest: string;
  mode: TransportMode;
  minutes: number;
  note: string;
}

/**
 * The founder's lived estimates, verbatim from golden-set v2
 * (red-penned 2026-08-06). Tier 1: a human traveled these. Stored as
 * seed rows that shadow same-pair ORS answers.
 */
export const FOUNDER_SEEDS: readonly FounderSeed[] = [
  { origin: "kensington", dest: "graffiti-alley", mode: "walk", minutes: 12, note: "Day 1: (walk ~12 min)" },
  { origin: "graffiti-alley", dest: "harbourfront", mode: "transit", minutes: 15, note: "Day 1: (streetcar ~15 min)" },
  { origin: "harbourfront", dest: "roundhouse", mode: "walk", minutes: 15, note: "Day 1: (walk ~15 min)" },
  { origin: "st-lawrence-market", dest: "distillery", mode: "walk", minutes: 20, note: "Day 2: (walk ~20 min…)" },
  { origin: "st-lawrence-market", dest: "distillery", mode: "transit", minutes: 12, note: "Day 2: (…or 504 ~12)" },
  { origin: "nathan-phillips", dest: "beamsville", mode: "drive", minutes: 75, note: "Day 6: depart 08:30 → 09:45" },
  { origin: "beamsville", dest: "nol-old-town", mode: "drive", minutes: 30, note: "Day 6: 10:45 → 11:15" },
  { origin: "falls", dest: "nathan-phillips", mode: "drive", minutes: 90, note: "Day 6: depart ~19:30, home ~21:00" },
];

/** Red-pen timestamp — the moment these observations were current. */
export const FOUNDER_FETCHED_AT = "2026-08-06T23:05:00-04:00";

export interface ProbeQuery {
  origin: string;
  dest: string;
  mode: TransportMode;
  /** Founder baseline in minutes; null = founder adjudicates live. */
  founderMinutes: number | null;
  note: string;
}

/** The CHECKPOINT 3 comparison set: 15 queries across all four modes. */
export const PROBE_QUERIES: readonly ProbeQuery[] = [
  // walk — founder-baselined
  { origin: "kensington", dest: "graffiti-alley", mode: "walk", founderMinutes: 12, note: "Day 1 leg" },
  { origin: "harbourfront", dest: "roundhouse", mode: "walk", founderMinutes: 15, note: "Day 1 leg" },
  { origin: "st-lawrence-market", dest: "distillery", mode: "walk", founderMinutes: 20, note: "Day 2 leg" },
  // walk — no recorded baseline (brief-mandated pairs)
  { origin: "kensington", dest: "rom", mode: "walk", founderMinutes: null, note: "brief pair" },
  { origin: "nathan-phillips", dest: "rogers-centre", mode: "walk", founderMinutes: null, note: "brief pair (downtown→Rogers)" },
  // cycle — no founder baselines exist; live adjudication at CHECKPOINT 3
  { origin: "kensington", dest: "trinity-bellwoods", mode: "cycle", founderMinutes: null, note: "adjudicate" },
  { origin: "st-lawrence-market", dest: "distillery", mode: "cycle", founderMinutes: null, note: "adjudicate" },
  { origin: "kensington", dest: "rom", mode: "cycle", founderMinutes: null, note: "adjudicate" },
  // drive — Day-6 corridor
  { origin: "nathan-phillips", dest: "beamsville", mode: "drive", founderMinutes: 75, note: "Day 6 leg (08:30 weekday-adjacent)" },
  { origin: "beamsville", dest: "nol-old-town", mode: "drive", founderMinutes: 30, note: "Day 6 leg" },
  { origin: "nol-winery", dest: "falls", mode: "drive", founderMinutes: null, note: "Day 6 leg (schedule has slack — adjudicate)" },
  { origin: "falls", dest: "nathan-phillips", mode: "drive", founderMinutes: 90, note: "Day 6 return" },
  // transit — live Google, request-scoped
  { origin: "graffiti-alley", dest: "harbourfront", mode: "transit", founderMinutes: 15, note: "Day 1 streetcar" },
  { origin: "st-lawrence-market", dest: "distillery", mode: "transit", founderMinutes: 12, note: "Day 2, 504" },
  { origin: "rom", dest: "nathan-phillips", mode: "transit", founderMinutes: null, note: "Day 3 'subway 2 stops' — adjudicate" },
] as const;

/**
 * Provenance-chain proof: a pair deliberately absent from storage and
 * not fetched as transit — the chain must fall through to the stub and
 * answer tier 3 / stub_haversine.
 */
export const STUB_FALLTHROUGH_QUERY: ProbeQuery = {
  origin: "distillery",
  dest: "trinity-bellwoods",
  mode: "walk",
  founderMinutes: null,
  note: "deliberately unstored — proves honest downgrade to tier 3",
};
