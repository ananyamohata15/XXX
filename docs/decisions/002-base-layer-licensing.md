# Decision 002 — Base-layer licensing: Foursquare OS Places, OSM/ODbL, and the Google boundary

- **Ticket**: XXX-25 (scope amended forward by Session 4's Checkpoint 1
  ruling — the base layer was promoted; the sweep deadline is unchanged)
- **Status**: PROPOSED (Checkpoint 1 pending — the OSM recommendation in
  §2 requires an explicit ruling before anything downstream assumes it)
- **Research date**: 2026-08-05
- **Documents reviewed** (fetched live on the research date):
  - Hugging Face dataset card `foursquare/fsq-os-places` (license field,
    release structure) — https://huggingface.co/datasets/foursquare/fsq-os-places
  - Foursquare OS Places access documentation —
    https://docs.foursquare.com/data-products/docs/access-fsq-os-places
  - Foursquare OS Places schema —
    https://docs.foursquare.com/data-products/docs/places-os-data-schema
  - foursquare.com open-source landing page (thin; no license text — noted) —
    https://opensource.foursquare.com/os-places/
  - Apache License, Version 2.0 — https://www.apache.org/licenses/LICENSE-2.0
  - Open Data Commons Open Database License (ODbL) v1.0 —
    https://opendatacommons.org/licenses/odbl/1-0/
  - OpenStreetMap copyright page — https://www.openstreetmap.org/copyright
  - OSMF Licence Community Guidelines (index + Collective Database
    Guideline) — https://osmfoundation.org/wiki/Licence/Community_Guidelines
- **We are not lawyers.** This is an engineering reading. Ambiguities are
  recorded and the conservative reading adopted in each case (project law
  since Session 4). Counsel review before public launch remains open.

## 1. Foursquare OS Places

### License: Apache 2.0 — verified, with one distribution-channel caveat

The Hugging Face dataset card states the license as `apache-2.0`: "The
dataset is available under the Apache 2.0 license", linking to
https://www.apache.org/licenses/LICENSE-2.0. The Foursquare access docs
carry the standard notice:

> "Copyright 2024 Foursquare Labs, Inc. All rights reserved. Licensed
> under the Apache License, Version 2.0"

Apache 2.0 §2 grants:

> "a perpetual, worldwide, non-exclusive, no-charge, royalty-free,
> irrevocable copyright license to reproduce, prepare Derivative Works
> of, publicly display, publicly perform, sublicense, and distribute the
> Work."

**Storage, modification, commercial use: all expressly granted.** This is
the inverse of the Google regime: enumerated permission covering
everything we need, durable rows included. No share-alike.

Redistribution conditions (§4) attach only "when You reproduce and
distribute copies of the Work or Derivative Works": include a copy of the
License, mark modified files, retain notices. **Serving an app on top of
the data is not redistribution of the dataset**; §4 does not bite our
runtime. It would bite if we ever ship the dataset (or a transformed
copy) to third parties — recorded as a future-trigger, not a present
obligation.

**Attribution decision**: nothing in Apache 2.0 requires user-facing
attribution for service use. We will nonetheless carry a
"Places data © Foursquare Labs, Inc. (Apache 2.0)" line on an
about/credits surface — cheap, honest, and it pre-satisfies §4 notice
expectations if any output is ever deemed redistribution. **No per-card
attribution** (contrast Google, where policy requires in-container
attribution — decision 001 §4; attribution follows per-fact provenance,
and FSQ-sourced facts must not carry a Google Maps mark).

**Field/category carve-outs: none found.** The license applies to the
dataset as published; no per-field restrictions located in the license or
docs. (Contrast: nothing like Google's reviews/photos carve-outs.)

### Practical layer

- **Distribution**: Foursquare Places Portal (Iceberg catalog, token
  gated); Hugging Face `foursquare/fsq-os-places`; Snowflake Marketplace;
  S3 (`s3://fsq-os-places-us-east-1/...`) with parquet releases under
  dated paths (`release/dt=YYYY-MM-DD/`).
- **Caveat — the Hugging Face gate**: the HF distribution adds a
  click-through beyond Apache 2.0: the accessor "agree[s] to allow
  repository authors to use your employer or entity name and logo in
  descriptions of its partners … in marketing materials", plus contact
  sharing. That is an access-gate term on that channel, not a dataset
  license term. ~~We pin and ingest from the S3/parquet release channel~~
  **SUPERSEDED same-day — see the Channel Addendum below: the S3 channel
  no longer exists; HF is the ruled channel.**
- **Version pinned**: `dt=2026-07-09` (latest release visible on the
  research date). Every ingested row records this version in provenance.
- **Update cadence**: not contractually stated anywhere we found.
  Releases are date-pinned; cadence observed from release history is
  roughly monthly, but we do not build on that assumption — refresh is a
  deliberate re-ingestion of a newer pinned release (upsert semantics:
  Step 2 design), on our schedule.
- **Relevant schema fields** (exact names, from the schema doc):
  `fsq_place_id`, `name`, `latitude`/`longitude` ("WGS84 … front door or
  rooftop"), `address`, `locality`, `region`, `postcode`, `country`,
  `fsq_category_ids`/`fsq_category_labels` (separate hierarchical
  categories table, breadcrumbs with ">"), `date_created`,
  `date_refreshed`, `date_closed`, and `unresolved_flags` (array
  including `closed`, `duplicate`, `delete`, `doesnt_exist`,
  `privatevenue`, `inappropriate`) — the quality-filter inputs.

## 2. OpenStreetMap (ODbL) — the consequential analysis

### The controlling text

OSM data is licensed by the OpenStreetMap Foundation under ODbL 1.0
("If you alter or build upon our data, you may distribute the result
only under the same license" — osm.org/copyright). ODbL definitions:

> **Derivative Database** — "a database based upon the Database, and
> includes any translation, adaptation, arrangement, modification, or
> any other alteration of the Database or of a Substantial part of the
> Contents."

> **Collective Database** — "this Database in unmodified form as part of
> a collection of independent databases in themselves that together are
> assembled into a collective whole."

> **Produced Work** — "a work (such as an image, audiovisual material,
> text, or sounds) resulting from using the whole or a Substantial part
> of the Contents (via a search or other query) from this Database."

Share-alike (§4.4): a Derivative Database that is **Publicly Used** must
be offered under ODbL (or compatible). Collective Databases are exempt
(§4.5). Produced Works need attribution but not database relicensing.

Our app serving itineraries is Public Use. So the question is exactly
one thing: **would our places database be a Derivative Database or a
Collective Database?**

### The produced-work argument does not save us

A rendered timeline card could be a Produced Work. But the thing we are
building this session is not a rendering — it is a **database** of place
identities that we operate publicly. The produced-work escape covers
outputs; it does not cover the combined database behind them. If the
database is derivative, share-alike attaches to the database regardless
of how pretty the output is.

### The Collective Database Guideline applied honestly

The OSMF guideline's test:

> "so long as a particular data type within a database consists entirely
> of non-OSM data within a regional cut, the OSM and non-OSM datasets
> will be considered 'independent' and thus, the combination will be
> considered a Collective Database rather than a Derivative Database."

Two of its POI examples bracket our use case precisely:

- **Safe side**: proprietary restaurant *phone numbers* linked to OSM
  objects by reference — phone numbers are a distinct data type,
  entirely non-OSM in the cut → "Your phone numbers are not subject to
  share-alike."
- **Our side**: "complement your proprietary restaurant list with
  corresponding data from OpenStreetMap removing any duplicate objects"
  — **"would not be covered by this guideline"**; share-alike exposure.

What we want OSM *for* is exactly the second example: OSM POIs would
enter the same table, as the same data type (place identity: name +
coordinates + category), in the same regional cut (Toronto), deduplicated
against FSQ rows by our matching pipeline. The "particular data type …
entirely non-OSM within the regional cut" test fails by construction —
the data type would be *mixed* OSM/non-OSM. That is a Derivative
Database under the guideline's own logic, publicly used, and §4.4 then
requires offering the combined database under ODbL. Conservative reading
of the blast radius: that plausibly encumbers the FSQ-derived rows and
our own metadata that are inseparably merged with OSM contents —
i.e. share-alike over the pool we intend to be proprietary rank-model
input. (Apache-2.0 FSQ data *can* legally be relicensed into an ODbL
database — the licenses are compatible in that direction — but then our
combined pool must be published on request. That is a product decision,
not a legal impossibility, and we decline it.)

### Isolation examined, then rejected

Could we hold OSM in a separate schema/table with a documented boundary?
Physical separation is neither necessary nor sufficient — the guideline
says "Two data sets need not be physically separated to qualify as
'independent'", and the converse holds: separated tables that we then
cross-match, dedup, and jointly query as one place pool are functionally
one database of one data type. The moment the matching pipeline
compares an OSM row to an FSQ row and suppresses one as a duplicate, we
are back inside the uncovered example. Isolation that *would* be safe —
OSM as a wholly separate data type never reconciled with the pool —
delivers none of the value we wanted OSM for.

### Recommendation (requires explicit ruling)

**Defer OSM entirely. Ship the base layer FSQ-only.**

- The pool math does not need OSM: Session 4 discovered 760 Google
  place_ids in nine Toronto neighborhoods; FSQ OS Places is a
  100M+-POI dataset with strong North American coverage, and Toronto is
  the founder-ground-truthed city. If Checkpoint 4 shows category gaps,
  the founder ground-truth channel (tier 1) exists precisely to fill
  high-value holes.
- A smaller compliant pool beats a larger encumbered one (session law).
  The failure mode of getting ODbL wrong is not a fee — it is a
  copyleft obligation over the database that is supposed to become our
  moat, discovered at launch review.
- Deferral is reversible: if a future city (Delhi) has FSQ gaps that OSM
  demonstrably fills, we revisit with three options then — true
  isolation as a distinct data type, ODbL-compliant publication of a
  cleanly-scoped derivative layer, or licensed commercial data instead.
  That future decision doc starts from this one.
- Per the session brief: if deferral is ruled, **no OSM code, schema, or
  scaffolding exists this session.**

## 3. The Google boundary (confirming against decision 001)

Three assertions, each checked against 001:

1. **Storing `google_place_id` on an FSQ-sourced `places` row** — within
   the SST §3 indefinite place_id grant (001 §1). The id is a link, not
   content; 001's decision table already routes it to
   `places.google_place_id`.
2. **Storing our match-confidence metadata** (confidence state, method,
   matched-at timestamp) — this is our request metadata / Customer Data,
   same class as `discovery_hits` (001 §6 last row). It records what *our
   pipeline* concluded, not what Google said.
3. **The request-scoped name confirmation** — a Place Details call with
   field mask `id,displayName`. The comparison (FSQ `name` vs. Google
   `displayName`, token/trigram similarity) happens **in the matching
   script's process memory during the run**. Discarded: `displayName`
   and every other response byte except the id we already hold. The
   Google name is never written to the database, traces,
   trace-event metadata, logs, fixtures, or error messages. What
   persists: the pre-existing place_id link + our confidence metadata.
   This is 001's ambiguity-2 pattern (request-scoped in-memory use, not
   caching), applied at ingestion time instead of generation time.

**One new ambiguity** (recorded, conservative handling proposed): is a
*numeric name-similarity score* a persisted "derived value" of Google
content (001 forbids persisting values computed from Google fields, e.g.
a score derived from rating)? Argument that it is not: the score is a
property of the *pair* (our name, their name), cannot be inverted to
recover the Google name, cannot substitute for any Google field, and
scores the link whose storage is expressly granted — it passes the
SST §8.1.4 "cannot be identified with / reverse-engineered / substituted
for" test in a way a cached rating-derived score does not. Proposed
handling: persist the categorical confidence state always; persist the
numeric score as well *unless* the Checkpoint 1 ruling prefers maximal
conservatism (state-only), which the rank model can live with.

## 4. Decision table

| Source | Use? | Fields we take | Stored durably? | Attribution shown | Tier for identity facts |
|---|---|---|---|---|---|
| **FSQ OS Places** (`dt=2026-07-09`, HF parquet channel — see Channel Addendum) | **Yes** — the base layer | `fsq_place_id`, `name`, `latitude`, `longitude`, `address`, `locality`, `region`, `postcode`, `country`, `fsq_category_ids`/`labels`, `date_created/refreshed/closed`, `unresolved_flags` (filter input only) | Yes — `places` + identity facts, full provenance incl. dataset version | Credits surface: "Places data © Foursquare Labs, Inc. (Apache 2.0)". No per-card mark. | **2 (Observed)** — see argument below |
| **OSM** | **Defer** (recommended — needs ruling) | — | No | — | — |
| **Google Places** | Link + confirm only | `id` (stored), `displayName` (request-scoped, discarded) | Only `google_place_id` + our match metadata | n/a at ingestion (nothing displayed); Google-fetched display data keeps 001's rules | n/a (not a fact source here) |
| **Founder ground-truth** | Yes (existing channel, unchanged) | whatever the founder attests | Yes | none needed | **1 (Verified)** |

**The tier argument.** Tier 1 "Verified" means a fact verified against
the authoritative source at a known fetch time — a live API answer
(Session 4: Google coordinates, tier 1) or a human standing in front of
the place (founder ground-truth: the founder *is* the verification).
An open-dataset identity is neither: it is a community/aggregate
observation, snapshotted at a publication date, with staleness measured
in months (`date_refreshed` tells us how stale) and an explicit
`unresolved_flags` uncertainty channel. That is the definition of
**tier 2 Observed**: credible, sourced, not freshly verified. Assigning
FSQ tier 1 would erase the distinction the tier system exists to draw —
and would make founder corrections (tier 1 overriding tier 2) impossible
to express. FSQ identity facts: **tier 2**, `source='fsq_os_places'`,
with the dataset version in provenance metadata.

## Channel Addendum (2026-08-05, same day — ruled at the Step 3 stop)

### The S3 sunset, established live

The first live contact with the pinned S3 path failed; investigation
(anonymous public listing, not just the driver error) found the bucket
`fsq-os-places-us-east-1` holding exactly two objects — `LICENSE.txt`
(full Apache 2.0 text) and `NOTICE.txt` (© 2025 Foursquare Labs; Apache
2.0 restated; attribution guidance) — with the `release/` prefix empty.
The dataset's AWS Open Data registry page is 404. Foursquare's release
notes (October 2025): "We've deprecated the public S3 bucket and replaced
it with an Iceberg catalog accessible via our new Places Portal"; old
releases were to remain "for a period of time", which has ended. The
July 2026 release (`dt=2026-07-09`) is current and distributed via the
Places Portal (account + token), Hugging Face (gated), and Snowflake.

The license itself is unchanged — LICENSE.txt/NOTICE.txt from
Foursquare's own bucket are stronger primary evidence of Apache 2.0 than
the docs pages ever were.

### Places Portal: DECLINED (terms reviewed before acceptance)

Portal access is conditioned on contracts whose clauses directly
prohibit our use or convert Apache-granted rights into revocable
privileges:

- **Spatial Master ToS §4.1(a)** — no creating or augmenting location
  databases, internal or external. Our base layer *is* a location
  database.
- **Developer Master Terms §7.5.8** — no developing POI datasets.
- **Developer Master Terms §8** — underlying data deemed Confidential
  Information (irreconcilable with an open-data base layer).
- **Developer Master Terms §13/§14** — at-will termination with
  destroy-all-copies and audit obligations (converts indefinite Apache
  rights into a revocable license with a kill switch over our pool).

A contract accepted at the door overrides the license on the files. We
do not walk through that door.

### Hugging Face: RULED IN (on its merits)

The HF gate asks for contact information and permission to use the
accessor's name/logo in Foursquare marketing. These terms are
access-vanity, not use-restrictions: they restrict the *door*, not the
*data*. Apache 2.0 travels with the files intact; nothing in the gate
purports to govern how the dataset is used after download. Annoying ≠
encumbering. The gate is accepted deliberately by the founder (their
account, their name), and `HF_TOKEN` is handled with API-key hygiene:
environment only, never read from files by the session, never logged.

### The standing rule this confirms

**For any distribution channel, the governing question is whether its
terms restrict *use of the data* or merely *access to the channel*.**
Use-restrictions (Portal) are disqualifying regardless of convenience;
access-terms (HF gate) are evaluated on their merits and accepted
knowingly or not at all. Applies to every future source and channel.

### NOTICE.txt obligation (new, channel-independent)

NOTICE.txt instructs that attribution preserve its full content. We
carry `NOTICE.txt` verbatim in-repo (`docs/licenses/`) and surface it
with the credits attribution from §1 — the conservative reading of its
API-form guidance applied to our app.

## Ambiguities recorded (conservative reading adopted in each)

1. **Apache 2.0 applied to data.** Apache 2.0 is a software license; its
   copyright-grant mechanics applied to a factual dataset are legally
   untested (facts themselves may not be copyrightable in some
   jurisdictions — which would only *widen* our rights). Conservative
   reading: treat the license as binding contract terms as written;
   comply with §4 if we ever redistribute. No practical constraint today.
2. **HF gate terms** (§1): channel-specific click-through, avoided by
   using the S3 channel; reviewed before acceptance if encountered there.
3. **ODbL blast radius** (§2): whether share-alike would truly encumber
   the whole merged pool is arguable; we adopt the reading that it
   plausibly does, which is one of the reasons to defer OSM rather than
   litigate the boundary from inside it.
4. **Similarity-score persistence** (§3): argued permissible; categorical
   state is the conservative floor; ruling requested.
5. **fetched_at for dataset rows** — flagged for Step 2 (design, not
   licensing): candidate semantics are dataset-publication-date
   (2026-07-09) vs. ingestion date. Preview of the Step 2 argument:
   `fetched_at` answers "when was this observation current?", which for
   a snapshot dataset is the **publication date**; ingestion date is
   pipeline metadata and belongs in the trace. To be argued and decided
   at Checkpoint 2.
