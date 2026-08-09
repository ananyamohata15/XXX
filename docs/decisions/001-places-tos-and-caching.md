# Decision 001 — Google Places ToS: what we may store, for how long, and the map coupling

- **Ticket**: XXX-21
- **Status**: PROPOSED (Checkpoint 1 pending)
- **Research date**: 2026-08-05
- **Documents reviewed** (official Google sources only, fetched live on the
  research date):
  - Google Maps Platform Terms of Service ("main ToS"), last modified
    **June 23, 2026** — https://cloud.google.com/maps-platform/terms
  - Google Maps Platform Service Specific Terms ("SST"), last modified
    **June 10, 2026** — https://cloud.google.com/maps-platform/terms/maps-service-terms
  - Places API (New) Policies —
    https://developers.google.com/maps/documentation/places/web-service/policies
  - Place IDs documentation —
    https://developers.google.com/maps/documentation/places/web-service/place-id
  - Places API (New) pricing —
    https://developers.google.com/maps/billing-and-pricing/pricing
  - EEA Service Specific Terms (checked to confirm they do **not** bind us) —
    https://cloud.google.com/terms/maps-platform/eea/maps-service-terms
- **We are not lawyers.** This document records an engineering reading of the
  terms. Wherever the terms are ambiguous, the ambiguity is recorded and the
  conservative reading is adopted (session rule). Counsel review before public
  launch is an open item.

## Which terms bind us

The SST open with: non-EEA billing addresses get these terms; EEA billing
addresses get the EEA Service Specific Terms. Our Google Cloud billing
address is Canadian (assumption — flagged for confirmation; nothing below
changes if it is US), so the **non-EEA** main ToS + SST apply. The EEA terms
are a materially different regime (EEA SST §15.1 forbids using Places content
*with any map* except lat/lng/place_id, and §15.2 points to a separate
"Places API EEA Permitted Uses" policy) — noted only so nobody cites them at
us by accident.

## 1. Caching and retention, per field class

### The controlling clauses (quoted)

Main ToS **§3.2.3 "Restrictions Against Misusing the Services"**:

> **(a) No Scraping.** Customer will not export, extract, or otherwise scrape
> Google Maps Content for use outside the Services. For example, Customer
> will not: (i) pre-fetch, index, store, reshare, or rehost Google Maps
> Content outside the services; (ii) bulk download … places information …;
> (iii) **copy and save business names, addresses, or user reviews**; …

> **(b) No Caching.** Customer will not cache Google Maps Content **except as
> expressly permitted under the Maps Service Specific Terms.**

SST **§3 "Google ID Caching"** (General Service Terms):

> Customer may cache the Google ID values from the Services that return such
> field and allow caching, in accordance with its Documentation. For example,
> Customer may cache (a) **place_id** from Places API …

SST **§14 "Places API (Legacy and New)"**:

> **14.3 Caching.** Customer may temporarily cache **latitude and longitude
> values** from the Places API for up to **30 consecutive calendar days**,
> after which Customer must delete the cached latitude and longitude values.

Place IDs documentation: place IDs are "exempt from the caching restrictions"
of §3.2.3(b); Google "recommends refreshing place IDs if they are more than
12 months old"; refresh via a Place Details request with an id-only field
mask is **free**.

### What this adds up to

The grant structure is *enumerated permission*, not enumerated prohibition:
**anything not expressly granted a caching window may not be stored.** For
the Places API the complete list of grants is:

| Field class | May we store it? | Retention window (exact) |
|---|---|---|
| **Place ID** (`id`) | Yes | Indefinite (SST §3 + Place ID docs). Refresh recommended at 12 months; refresh is free. |
| **Latitude/longitude** (`location`) | Yes, temporarily | **30 consecutive calendar days**, then delete (SST §14.3). Refresh restarts the window. |
| **Core identity** — name, address | **No.** | None granted. §3.2.3(a)(iii) names "copy and save business names, addresses" as a prohibited example. |
| **Volatile** — hours, price level/range, rating, rating count, website, phone, types | **No.** | None granted. §3.2.3(b) forbids all caching not expressly permitted; no SST clause permits these. |
| **Reviews** (text, authorship) | **No.** | §3.2.3(a)(iii) explicitly; plus display-time author-attribution rules (policies). |
| **Photos** (image content and photo references) | **No.** | No grant. Serve via the Places photo endpoint at view time. |

There is no 30-day (or any) general cache window for Places content in the
current non-EEA terms. The historical "everything cacheable 30 days" rule is
gone; only lat/lng carries a 30-day window today, and place IDs are the only
indefinite grant.

## 2. The refresh obligation

The ToS imposes no freshness duty on stored data for the simple reason that
(place IDs and lat/lng aside) storage is not permitted at all. Concretely:

- **Place IDs**: refresh when >12 months old (recommendation, not
  obligation). Free via id-only Place Details. XXX-25 gets a yearly sweep.
- **Lat/lng**: not a refresh *cadence* but a hard retention ceiling — every
  stored coordinate must be re-fetched or deleted within 30 days. Our planned
  3–4 day refresh cadence over-satisfies this if coordinates ride along on
  any refresh call (location is an Essentials-tier Place Details field,
  $5/1,000 list price, under the 10K/month free Essentials cap at our
  volume — effective cost ≈ $0). XXX-25 must also enforce the ceiling
  independently of the happy path: any place whose coordinates were last
  fetched >30 days ago and can't be refreshed gets its coordinates deleted
  (honest absence), not silently kept.
- **Everything else**: the 3–4 day cadence question is moot — those fields
  are fetched at view/generation time, never stored, so freshness is
  automatic (each display shows data from the moment it was fetched).

## 3. Map-display coupling — the decision

- **Without any map: allowed.** SST §14.1: "Customer may use Google Maps
  Content from the Places API in Customer Applications without a
  corresponding Google Map." The timeline — our primary surface — is
  compliant as designed.
- **On a non-Google map: forbidden.** Main ToS §3.2.3(e) "No Use With
  Non-Google Maps": "Customer will not (i) display or use Places content on
  a non-Google Map." SST §14.2 repeats it for Places specifically.

**Decision: the app ships mapless (timeline only) for now. If/when a map
surface is built, it is a Google map (Maps JavaScript API / Maps SDK) — the
MapLibre + third-party-tiles stack is dead** for any screen showing
Google-sourced places. (Escape hatch, recorded not planned: SST §15.1 lets
the *Places UI Kit* widget be used with non-Google maps; it's a rendered
component with its own pricing, not raw data, so it does not change our data
architecture.)

## 4. Attribution requirements

From the Places policies page (Documentation is binding via main ToS
§3.2.2(b) and SST §1):

- Google-sourced places data displayed **without a map** must carry Google
  Maps attribution: the Google Maps logo where possible, or the text
  "Google Maps" where space-limited; positioned near the top or bottom of
  the content, same visual container, never obscured. Specs: logo 16–19dp
  high, stated clear-space; text in Roboto 400, 12–16sp, ≥4.5:1 contrast.
- Third-party data-provider attributions returned in the `attributions`
  field must be shown when present.
- Reviews (view-time only for us): author avatar/name/profile link, a link
  to the source on Google Maps via `googleMapsUri`, notice of
  ordering/filtering; photos: author attribution unless thumbnail with
  full-view elsewhere.
- Attribution must never be modified, obscured, or deleted (main ToS
  §3.2.2(b)).

Product consequence: any timeline card showing Google-fetched hours/rating
carries "Google Maps" attribution in-container. Cards whose facts come from
other sources (founder ground-truth, later Foursquare/OSM) must **not**
imply Google attribution — attribution follows provenance, which the E1
`source` column already gives us per fact.

## 5. What we must NOT store — and the honest-absence answer

Per the table in §1: names, addresses, hours, prices, ratings, reviews,
photos, types — all fetch-on-view (or fetch-at-generation, request-scoped),
or not shown. Per-field decisions:

- **Hours, price level, rating, rating count**: fetch at day-generation /
  view time; used in-memory by the validator and concierge; displayed with
  attribution; never written to `facts`.
- **Reviews**: not fetched in E3 at all (no product surface needs them);
  if ever shown, view-time only with the author-attribution rules above.
- **Photos**: not fetched in E3; later, served via the photo endpoint at
  render time.
- **Editorial summaries / AI summaries**: not used (Enterprise+Atmosphere
  SKU cost, plus disclosure-text rules); revisit only with a product need.

## 6. Decision table — the cache policy the schema implements

"Store?" means a durable row in our database (`places` / `facts`).

| Datum (API field) | Store? | Retention | Refresh | Attribution when displayed |
|---|---|---|---|---|
| `id` (place ID) | **Yes** → `places.google_place_id` | Indefinite | Yearly, free (id-only mask) | — (identifier, not displayed) |
| `location` (lat/lng) | **Yes** → `places.lat/lng` | **≤30 days hard** | Every refresh ride-along; ceiling enforced by sweep (delete on expiry) | — |
| `displayName` | **No** | request-scoped only | n/a | Google Maps mark on the surface that shows it |
| `formattedAddress` | **No** | request-scoped only | n/a | same |
| `regularOpeningHours` | **No** | request-scoped only | n/a | same |
| `priceLevel` / `priceRange` | **No** | request-scoped only | n/a | same |
| `rating` / `userRatingCount` | **No** | request-scoped only | n/a | same |
| `websiteUri` / phone | **No** | request-scoped only | n/a | same |
| `types` / `primaryType` | **No** | request-scoped only | n/a | same |
| `reviews` | **No** (not fetched in E3) | — | — | author attribution + `googleMapsUri` if ever shown |
| `photos` | **No** (not fetched in E3) | — | — | photo attribution rules |
| Our request metadata (search category, neighborhood anchor, discovered_at, trace ID) | **Yes** — ours, not Google Maps Content | ours | ours | — |

### What this does to XXX-22 (the consequence, stated plainly)

The ticket says "writing provenanced facts into the E1 schema." Under the
conservative reading, **Google cannot be the source of durable `facts`
rows.** What ingestion legally produces is a **discovery pool**: `places`
rows carrying `google_place_id` (indefinite) + coordinates (30-day TTL) +
our own request metadata, with `source='google_places'` provenance on the
identity snapshot. Durable names/hours/ratings in our schema must come from
sources that permit storage (founder ground-truth now; the Foursquare/OSM
base layer later in E3 — this decision **promotes the base layer's
priority**, flagged as a roadmap question). Google volatile fields are
fetched request-scoped at generation/view time, where they still flow
through the E1 provenance shape (source/tier/fetched_at) in memory —
provenance-at-creation applies to transient facts too; they just never hit
disk. Exact ingestion shape is Step 2's proposal, gated on this doc.

Note on `places.name`: E1 made `name NOT NULL` — a Google-discovered place
with an unstorable name needs a Step 2 answer (options: base-layer/founder
name required before a row exists, or a schema amendment). Recorded here,
decided at Checkpoint 2.

## Adjacent constraints worth recording (bit us later otherwise)

- **No ML training on Google content** — §3.2.3(c)(vii): Google Maps Content
  may not be used "to improve machine learning and artificial intelligence
  models, including to train, test, validate or fine-tune." The future rank
  model must not train on Google-sourced fields; runtime LLM *inference*
  over fetched facts inside the app is use within the Customer Application,
  not model improvement (reading recorded below). Never log Google content
  into any training/eval dataset.
- **No point-in-polygon** — §3.2.3(c)(iv): Places lat/lng may not feed
  point-in-polygon analysis. Neighborhood assignment must come from our own
  query metadata (which anchor we searched), not from testing Google
  coordinates against polygons.
- **No directory product** — §3.2.3(d)(iii): no "listings or directory
  service." We are an itinerary concierge with substantial independent
  value; keep it that way (no browsable place directory built on Google
  data).
- **Derived content** — §3.2.3(c) + the "Customer Data" definition
  (SST §8.1.4): derivatives are ours only if substantially transformed such
  that they can't be identified with, reverse-engineered to, or substituted
  for Google content. Conservative: we do not persist values computed *from*
  Google fields (e.g. a score derived from rating) either.

## Ambiguities recorded (conservative reading adopted in each case)

1. **"for use outside the Services"** (§3.2.3(a)) could be read to permit
   internal storage that powers an app built on the Services. Conservative
   reading adopted: any persistence of the enumerated content in our
   database is prohibited; the enumerated grants (place ID, lat/lng 30d)
   are the whole universe of storage.
2. **Request-scoped in-memory use vs. "caching."** Holding fetched fields in
   memory for the seconds-to-minutes of one generation/render, never reused
   across requests, is *use*, not caching. Adopted; anything longer-lived
   (cross-request TTL caches, disk spill) is treated as caching and not done.
3. **LLM inference over Google content** vs. §3.2.3(c)(vii): adopted reading
   is that inference inside the product is permitted use and only model
   *improvement* (training/fine-tuning/eval) is prohibited. Enforced by
   never persisting Google content anywhere a training pipeline could reach
   (which we already can't, per storage rules) and relying on the Anthropic
   API's no-training-on-inputs posture.
4. **Photo references** (the `photos` resource names, distinct from image
   bytes) have no explicit grant either way. Conservative: not stored.
5. **Billing-address regime**: Canadian billing assumed → non-EEA terms. If
   billing were ever moved into the EEA, this entire document must be
   redone against the EEA terms (different and in places stricter).

---

## Addendum — 2026-08-09 (Session 10, XXX-33 CP1 ruling)

**Question.** XXX-33 requires every evidence row to record *the fact
version that was displayed*, so a claim ("the price is wrong") is
adjudicable against what the reporter actually saw. For Google-sourced
facts (hours, business status, price) §3.2.3(a) and ambiguity 1 above
forbid persisting the value. Recording nothing would make the claim
unadjudicable; recording the value would breach the storage rule.

**Ruling adopted.** Persist a **sha256 digest of the displayed value's
canonical JSON** (`evidence.shown_digest`), never the value itself,
alongside the metadata we already own outright — status, source, tier
and `fetched_at`, which are our own observations about a fetch, not
Google content (same reasoning as `discovered_places.coords_fetched_at`
surviving the TTL sweep: the timestamp is Customer Data, the value is
not).

**Reasoning.** A cryptographic digest is one-way and
non-reconstructible: it cannot be read back, decompiled into the
original, substituted for Google content, or used to answer any question
about a place. Its only capability is *change detection* — proving that
what was displayed then differs from what is fetched now. That is
strictly weaker than the "substantially transformed" test in the Derived
content rule above, which the conservative reading already declines to
lean on; a digest is not a derivative of the content's meaning at all,
it is an opaque fingerprint of a byte sequence.

**Scope limit.** The digest is stored only for adjudication of a
reporter's claim. It is never used to reconstruct, compare against, or
seed any place data; it never enters a generation, a score, or a
training/eval dataset (the no-model-improvement rule above applies to it
unchanged).

**Cost of reversal.** If this reading is ever judged too liberal,
dropping `shown_digest` costs only the ability to prove a value
*changed*; the remaining `shown_*` columns still record what kind of
fact was shown, from which source, at which tier, fetched when. One
forward-only migration, no data model change.
