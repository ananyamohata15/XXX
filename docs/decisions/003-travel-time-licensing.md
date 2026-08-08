# Decision 003 — Travel-time source licensing: Google Routes, ORS/ODbL for computed durations, self-hosting, and GTFS

- **Ticket**: XXX-24 (whose wording this doc partially supersedes — see §6;
  flagged in advance by XXX-25 comment 10288: "a Routes ToS pass
  (decision-doc treatment) is required before any travel-time caching is
  built; CLAUDE.md's 'Google Routes (transit, cached)' line is provisional
  until then").
- **Status**: **RATIFIED at Checkpoint 1 (2026-08-07)** — both requested
  rulings granted; see the Checkpoint 1 Outcome addendum at the end of
  this document for the riders that bind the implementation.
- **Research date**: 2026-08-07. All documents fetched live today.
- **Documents reviewed**:
  - Google Maps Platform Service Specific Terms ("SST"), last modified
    June 10, 2026 — https://cloud.google.com/maps-platform/terms/maps-service-terms
    (full page downloaded and grepped; §19 quoted verbatim below)
  - Google Maps Platform main ToS — https://cloud.google.com/maps-platform/terms
    (controlling clauses already quoted in decision 001; incorporated by
    reference, not re-fetched)
  - Routes API policies (attribution) — last updated 2026-07-31 —
    https://developers.google.com/maps/documentation/routes/policies
  - Routes API usage and billing + SKU details —
    https://developers.google.com/maps/documentation/routes/usage-and-billing,
    https://developers.google.com/maps/billing-and-pricing/sku-details
  - Google Maps Platform pricing lists (Routes SKUs) —
    https://developers.google.com/maps/billing-and-pricing/pricing
  - HeiGIT Terms of Service (governs hosted openrouteservice) —
    https://account.heigit.org/info/tos — an Angular SPA; the ToS text was
    extracted from the page's application bundle (chunk containing the
    Terms-of-Service component), method recorded in §7 ambiguity 6
  - HeiGIT plans/quota configuration (same app, plans component) — the
    free-tier quota numbers in §2; same extraction caveat
  - OSMF Community Guidelines, Produced Work Guideline —
    https://osmfoundation.org/wiki/Licence/Community_Guidelines/Produced_Work_-_Guideline
  - OSMF Community Guidelines, Substantial Guideline —
    https://osmfoundation.org/wiki/Licence/Community_Guidelines/Substantial_-_Guideline
  - ODbL 1.0 and the Collective Database Guideline — quoted at length in
    decision 002 §2; incorporated by reference
  - Open Government Licence – Toronto v1.0 —
    https://www.toronto.ca/city-government/data-research-maps/open-data/open-data-licence/
  - TTC Routes and Schedules dataset metadata (CKAN API) —
    https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=ttc-routes-and-schedules
  - OSRM engine license (BSD-2-Clause) —
    https://github.com/Project-OSRM/osrm-backend (LICENSE.TXT);
    openrouteservice engine license (GPL-3.0) —
    https://github.com/GIScience/openrouteservice
- **We are not lawyers.** This is an engineering reading. Ambiguities are
  recorded (§7) and the conservative reading adopted in each case (project
  law since Session 4). Counsel review before public launch remains open.

## 1. Google Routes API

### The controlling clauses (quoted)

SST **§19 "Routes API"**, in full:

> **19.1 Use without a Google Map.** Customer may use Google Maps Content
> from the Routes API in Customer Applications without a corresponding
> Google Map.
>
> **19.2 No use with a non-Google map.** Customer must not use Google Maps
> Content from the Routes API in conjunction with a non-Google map.
>
> **19.3 Caching.** Customer may temporarily cache latitude (lat) and
> longitude (lng) values from the Routes API for up to 30 consecutive
> calendar days, after which Customer must delete the cached latitude and
> longitude values.

SST **§3 "Google ID Caching"** (General Service Terms):

> Customer may cache the Google ID values from the Services that return
> such field and allow caching … For example, Customer may cache (a)
> place_id from Places API, Directions API, Geolocation API **and Routes
> API** …

Main ToS §3.2.3(b) (quoted in decision 001): no caching of Google Maps
Content "except as expressly permitted under the Maps Service Specific
Terms." The grant structure is enumerated permission, same as Places.

### What this adds up to — the caching question answered

**There is no caching grant for durations. None.** §19.3 is the complete
Routes caching universe and it covers lat/lng only (30 days). Travel
durations, distances, polylines, transit line details, fares — all are
Google Maps Content with no storage grant of any scope: not
session-scoped, not 30-day, not time-of-day-bucketed. The old XXX-24 plan
("Google Routes for transit, **cached** with time-of-day buckets so one
paid call serves many users") is **not permitted under the current
terms**. A Routes duration is request-scoped: fetched for one generation,
used in memory (decision 001 ambiguity 2's use-not-caching pattern),
displayed with attribution, discarded. One paid call serves one
generation.

Storable from Routes: nothing we need. place_id we already hold from our
own pool (indefinite grant, 001); lat/lng we hold from our own pool under
the Places 30-day regime (001) — we would never store coordinates *from
Routes*.

### The map-coupling question answered

§19.1 **expressly permits** using Routes content without any map. Bare
durations on our mapless timeline are compliant — the prohibition (§19.2)
is only against use *with a non-Google map*, and decision 001 already
rules that any future map surface is a Google map. No new constraint; the
timeline stays clean provided it never becomes a de-facto map rendering
over third-party tiles (001 §3 already forbids that).

### Attribution

Routes API policies (Documentation is binding via main ToS §3.2.2(b) and
SST §1): Google Maps attribution required when displaying Routes content
outside a Google map — logo where possible (16–19dp, stated clear space)
or the text "Google Maps" (Roboto 400, 12–16sp, ≥4.5:1 contrast), near
top or bottom, same visual container, never obscured. Identical regime to
Places (001 §4): **attribution follows provenance** — a timeline card
showing a Google-fetched transit duration carries the Google Maps mark; a
card showing an ORS or GTFS-derived duration must not.

### Pricing (cited, current)

Compute Routes SKUs (per 1,000 requests, first paid tier; each SKU has a
monthly free cap of "events"):

| SKU | Free cap/mo | Price/1,000 |
|---|---|---|
| Routes: Compute Routes Essentials (9EFF-679A-9B16) | 10,000 | $5.00 |
| Routes: Compute Routes Pro (02F7-1B55-DC90) | 5,000 | $10.00 |
| Routes: Compute Routes Enterprise (6EBD-08E5-319A) | 1,000 | $15.00 |

Compute Route Matrix is billed **per element** (origins × destinations);
a TRANSIT matrix request is capped at 100 elements. SKU triggers, from
the SKU details page: Essentials = basic features ≤10 intermediate
waypoints; Pro = 11–25 waypoints, `optimizeWaypointOrder`,
`TRAFFIC_AWARE`/`TRAFFIC_AWARE_OPTIMAL`, side-of-road/heading/stopover
modifiers; Enterprise = two-wheeler, toll calculation, traffic on
polylines. **`travelMode: TRANSIT` appears in no Pro or Enterprise
trigger list → transit bills as Essentials** ($5/1,000, 10K free/month).
Recorded as an inference from absence, with a verify-on-first-bill flag
(§7 ambiguity 3).

## 2. OpenRouteService hosted (HeiGIT) — the consequential findings

### The service terms (quoted)

The HeiGIT ToS covers "services operated and provided by HeiGIT gGmbH",
naming openrouteservice first. Three clauses matter:

Attribution:

> "When using services provided by HeiGIT make sure to have the proper
> attribution in your API implementation, site, or other properties …
> **© openrouteservice by HeiGIT | Data from OpenStreetMap**"

License on results — the sentence that decides the storage question:

> "**Results obtained from openrouteservice in any context are licensed
> under CC-BY-SA 4.0.**"

OSM passthrough:

> "For any OpenStreetMap data you obtain through our services, you have
> to comply with the Terms of Use by the OpenStreetMap Foundation …"

**No commercial-use prohibition exists in the ToS.** The constraints are
quotas (below) and conduct rules (unlawful use, abuse, overburdening).
Under the standing use-vs-access rule (decision 002): the quotas are
access terms — evaluated on their merits, accepted; the CC-BY-SA grant is
a *use* term — analyzed below.

### What CC-BY-SA-4.0-licensed results mean for storage

This is the operator of the service — who runs the ODbL Derivative
Database (their routing graph) — affirmatively licensing the *outputs* to
us as content under a known license. CC-BY-SA 4.0 grants reproduction,
redistribution, and adaptation, for any purpose including commercial, in
exchange for attribution and share-alike on adaptations we share.
**Storing ORS-computed durations is therefore expressly permitted** — the
question is what obligations the stored rows carry:

- **Attribution** — required when we share/display the material: the
  HeiGIT line above on the credits surface, and provenance-driven
  source labeling on any surface displaying an ORS-derived duration
  (same attribution-follows-provenance rule as Google and FSQ).
- **Share-alike** — CC-BY-SA attaches to *the licensed material and
  adaptations of it*, per work; it is **not** ODbL database-level
  share-alike and does not reach unrelated rows stored alongside. The
  blast radius of getting this wrong is bounded to the travel-time rows
  themselves. Conservative handling: the stored matrix lives in its own
  bounded table (`travel_times`), never merged into the places pool, so
  the CC-BY-SA material stays identifiable and separable.
- **No ML training** on ORS-derived durations (conservative: adaptation
  questions under SA are untested; mirrors 001's Google rule; the rank
  model loses nothing it was promised).

### The ODbL question argued honestly (the ruling this doc exists for)

Chain of custody: OSM (ODbL) → HeiGIT's routing graph (a Derivative
Database, operated by HeiGIT, their §4.4 problem not ours) → query
results (durations in minutes). Is a **stored matrix of those durations**
itself a Derivative Database of OSM, dragging ODbL share-alike onto it?

What the OSMF guidelines actually say:

- Produced Work Guideline: a Produced Work "result[s] from using the
  whole or a Substantial part of the Contents **(via a search or other
  query)**", and the discriminating test is: "**If the published result
  of your project is intended for the extraction of the original data,
  then it is a database and not a Produced Work.**"
- Substantial Guideline: extracts under "**less than 100 Features**" are
  insubstantial; but "**we regard repeated small extractions as one big
  extraction**" — systematic accumulation is judged as a whole.
- Neither guideline addresses computed routing durations by name. Doc
  002's Collective Database Guideline is also inapposite — that test is
  about *mixing OSM Contents into a data type*; a duration matrix
  contains no OSM Contents at all. **Stated plainly: the OSMF guidelines
  do not settle this question.** The analysis below is our reading; the
  conservative rider follows it.

The argument that stored durations are not a Derivative Database:

1. **A matrix of minutes contains zero OSM Contents.** No nodes, ways,
   tags, geometries, or names — unlike doc 002's POI case, where OSM
   rows would have entered our tables as the same data type. What is
   stored is the *output of a computation over* OSM data, two steps
   removed (graph build, then routing).
2. **It cannot be reverse-engineered into OSM data.** "Kensington→ROM,
   walking, 22 min" does not let anyone extract streets, speeds, or
   topology. It fails the Produced Work guideline's database test — it
   is not "intended for the extraction of the original data", and could
   not serve that purpose even if published.
3. **The operator's own licensing treats results as content, not
   database extract.** HeiGIT — who is bound by ODbL for the underlying
   graph — licenses "results … in any context" under CC-BY-SA, a
   content license. That posture is only coherent if results are
   Produced-Work-like outputs rather than extractions of the database.
4. **Scale**: this session's matrix is ~15–50 POI pairs × 3 modes — of
   the order of 100 numbers, none of them OSM Features. Even under the
   most data-hostile reading (each duration "re-utilises" the graph),
   the extraction is insubstantial at this scale.

**Adopted reading**: a stored matrix of ORS-computed durations at
golden-set/POI-pair scale is not a Derivative Database of OSM; it is
stored service output governed by HeiGIT's CC-BY-SA grant, handled as §2
above (bounded table, attribution, no ML training).

**The conservative rider — where the reading stops**: point 4 does real
work in that argument, and the Substantial Guideline's
"repeated small extractions are one big extraction" line reaches
systematic accumulation. A dense all-pairs matrix over the whole Toronto
pool (760 places → ~577K directed pairs × modes), maintained and
refreshed as infrastructure, is a different object — at that scale the
"we are just storing query outputs" argument starts describing the
construction of a routing database by systematic re-utilisation, and this
doc does **not** clear it. Ruling requested as part of Checkpoint 1:
**bulk matrix construction beyond golden-set/cluster scale (soft ceiling:
~1,000 stored pairs per city) requires a new decision-doc pass.** Within
that ceiling, storage is cleared per the reading above.

### Free-tier quotas (access terms, accepted)

From the HeiGIT plans configuration (Basic = free tier; same SPA-bundle
extraction caveat, §7 ambiguity 6): Directions 2,000 requests/day at
40/min; **Matrix 500 requests/day at 40/min** (one Matrix request carries
many origin×destination elements — per-request size limits verified at
build time); Isochrones 500/day. The next tier ("Standard") shows 10,000
Directions and 2,500 Matrix requests/day. Our probe (~15 pairs × 3 modes,
batched as a handful of Matrix requests) is far inside the free tier.
Cost: $0.

## 3. Self-hosted OSRM / openrouteservice (path recorded, not built)

- **Engine licenses**: OSRM is BSD-2-Clause; the openrouteservice engine
  is GPL-3.0. Running either as an internal network service is not
  distribution of the engine; GPL copyleft does not attach to our
  application code across an HTTP boundary. No constraint either way at
  our usage.
- **ODbL changes seats, not questions**: self-hosting makes *us* the
  operator of the Derivative Database (the routing graph built from an
  OSM extract). Publicly using works produced from it puts us in ODbL
  §4.4's frame directly: we must be prepared to offer the derivative
  database or "a file containing all of the alterations made", which for
  a routing graph is satisfiable by publishing the recipe (extract
  version + engine version + build profile — all open artifacts). Doable,
  but it is a real compliance posture we would own, plus the durations
  analysis of §2 unchanged (minus the CC-BY-SA grant — results would
  simply be ours, with OSM attribution).
- **Ops cost, honestly**: Toronto/Ontario-extract scale is small (a
  low-single-digit-GB build, runnable on a ~$10–20/month instance), but
  the true cost is operational surface — monthly extract updates, graph
  rebuilds, monitoring, and a second production service to keep alive.
  Not justified while the hosted free tier covers our volume; recorded as
  the escape hatch if HeiGIT quotas or terms ever move against us.

## 4. GTFS transit feeds (TTC)

### License

The TTC Routes and Schedules feed is published on the City of Toronto
open data portal (owner division: Toronto Transit Commission; GTFS ZIP;
refresh listed as Monthly, last refreshed 2026-07-13). The portal's
governing license is the **Open Government Licence – Toronto v1.0**:

> "The Information Provider grants you a worldwide, royalty-free,
> perpetual, non-exclusive licence to use the Information, **including
> for commercial purposes** … You are free to: Copy, modify, publish,
> translate, adapt, distribute or otherwise use the Information in any
> medium, mode or format for any lawful purpose."

Required attribution (no dataset-specific statement is provided):

> "Contains information licensed under the Open Government Licence –
> Toronto."

One metadata wrinkle: the dataset's CKAN record says
`license_title: License not specified`. Adopted reading (§7 ambiguity 4):
the portal licence governs portal datasets; we carry the attribution line
unconditionally.

**This is the inverse of the Google regime and the cleanest source in
this doc: storage, transformation, and commercial use expressly granted,
forever, for one line of credits text.**

### What we would compute, and the honest quality trade

Schedule-derived transit estimates are computed *by us* from the
timetable: walk to stop (ORS/stub) + scheduled wait + scheduled ride
(+ transfers). Our computed estimates are our own data — storable
without restriction, provenance `source='gtfs_ttc'` + feed version.

The trade against Google live transit routing, stated plainly:

- **What schedule math loses**: real-time delays/disruptions (GTFS-RT is
  a separate feed and a separate build), live vehicle positions,
  multi-agency routing (the TTC feed excludes GO/UP Express — separate
  Metrolinx feeds), and routing quality — correct transfer handling
  needs a real algorithm (RAPTOR or equivalent), which is a genuine
  engineering project, not a weekend script.
- **What it wins**: zero Google entanglement — stored, refreshable,
  time-of-day-bucketable transit estimates (the thing XXX-24 originally
  wanted, legal here because the data is ours), zero marginal cost, and
  full Delhi-readiness leverage (Delhi GTFS exists; quality varies —
  flagged as a forward question).
- **The honest fit**: for the *validator's* question ("is 35 minutes
  between A and B at 14:00 plausible?") schedule-derived estimates with
  a stated uncertainty band are adequate. For *display-time precision*
  ("leave 14:12, catch the 505"), live routing is better. These are
  different product needs and can have different sources.

## 5. Decision table — per source × mode

"Store?" means durable rows in our database. Costs are list, per 1,000
estimates, at our volume tier.

| Source × mode | Use? | Store? | Retention | Attribution when displayed | Cost/1,000 |
|---|---|---|---|---|---|
| Google Routes — transit | **Yes**, request-scoped at generation/view time | **No** (no grant exists) | In-memory, single generation | "Google Maps" mark, in-container | $5.00 (Essentials; 10K events/mo free) — §7 amb. 3 |
| Google Routes — walk/cycle/drive | No (ORS covers; permitted as request-scoped fallback only) | **No** | — | same | $5.00 |
| ORS hosted — walk/cycle/drive | **Yes** — primary | **Yes** — bounded `travel_times` table, ≤ ~1,000 pairs/city ceiling; beyond that, new decision pass | No legal ceiling (CC-BY-SA); freshness is ours — refresh policy set in Step 2, provenance `fetched_at` per row | "© openrouteservice by HeiGIT \| Data from OpenStreetMap" + CC-BY-SA 4.0 notice (credits surface; source label per card) | $0 (free tier: 500 Matrix req/day) |
| ORS hosted — transit | Not offered by ORS | — | — | — | — |
| Self-hosted OSRM/ORS — walk/cycle/drive | Deferred (escape hatch; §3) | (would be yes, ODbL posture owned by us) | — | OSM attribution | ~$10–20/mo infra + ops |
| GTFS (TTC) — transit, computed by us | **Yes** — the storable transit path (build scope decided in Step 2) | **Yes** — our computed estimates + the feed itself | Ours; re-derive on monthly feed refresh, feed version in provenance | "Contains information licensed under the Open Government Licence – Toronto" (credits surface) | $0 |
| Founder-measured times (golden pairs) | **Yes** — tier-1 seed + probe baseline | **Yes** — our own observations, always legal | Ours | none needed | $0 |
| Haversine stub (Session 7) | **Yes** — fallback floor | n/a (computed, not stored) | — | none (tier-3 judgment, narrated as estimate) | $0 |

**Tier mapping for travel facts** (extends doc 002's tier argument):
founder-measured = **1 Verified** (a human traveled it); routing-engine
results (ORS, Google request-scoped) = **2 Observed** (credible computed
estimate from a sourced engine, not verified by travel);
GTFS-schedule-derived = **2 Observed** (official published timetable, not
live-verified); haversine stub = **3 Judgment** (unchanged from
Session 7).

## 6. The architecture ruling — recommended posture

The three candidate postures, judged:

- **(a) All request-scoped** — legally bulletproof, but it prices every
  generation in API calls and quota risk for the modes where storage is
  *expressly granted* (ORS CC-BY-SA, GTFS OGL). Conservatism beyond what
  the conservative reading requires; rejected.
- **(b) Store what is legally clean, request-scope the rest** — matches
  the actual grant structure of the sources.
- **(c) Founder-measured tier-1 seeds for golden pairs** — always legal,
  but ~15 pairs cannot serve a city; it is a calibration layer, not a
  capability.

**Recommendation: (b) + (c).** Concretely:

1. **Walk/cycle/drive**: ORS hosted, stored in a bounded `travel_times`
   table (golden-set pairs this session; anything beyond the ~1,000
   pair/city ceiling re-argued per §2). Provenance
   `source='ors_hosted'`, tier 2, `fetched_at` = computation time.
2. **Transit**: request-scoped Google Routes (`travelMode: TRANSIT`,
   Essentials SKU) at generation time, never stored — with
   GTFS-computed stored estimates recorded as the entanglement-free
   successor, build scope proposed at Step 2 (a full RAPTOR build is
   out of this session's scope; the doc keeps the door open, the ticket
   board decides when).
3. **Founder-measured golden-pair times**: ingested as tier-1 facts —
   the probe baseline this session and the standing calibration set.
4. **Fallback chain per mode**: stored matrix → live provider
   (request-scoped) → haversine stub, provenance downgrading honestly
   at each step (2 → 2 → 3; the validator's tolerance policy already
   reads tier).

**E4 cost-per-generation implication, in dollars**: walk/cycle/drive —
$0 (stored ORS rows, free-tier refresh). Transit — a generated day has
~2–4 transit legs; at $5/1,000 that is **$0.010–$0.020 per generated day
at list**, and $0 while monthly transit calls stay inside the 10K-event
Essentials free cap (≈ 2,500–5,000 generated days/month free). Under
posture (a) every mode would price like transit (~4× the calls); under a
future GTFS build, transit goes to $0 and the line item disappears.
This number feeds XXX-29's cost model and E8's unit economics directly.

## 7. Ambiguities recorded (conservative reading adopted in each)

1. **Scope of HeiGIT's "Results … in any context are licensed under
   CC-BY-SA 4.0"** — "results" is not defined (durations only?
   geometries? isochrones?). Adopted: every byte of an ORS response is
   treated as CC-BY-SA material; obligations applied to all of it.
2. **ODbL status of computed durations** — the OSMF guidelines do not
   address routing outputs; our reading (§2) concludes
   not-a-Derivative-Database at bounded scale. Conservative riders
   adopted: bounded table, ≤~1,000 stored pairs/city, no ML training on
   ORS-derived rows, new decision pass before any bulk matrix.
3. **TRANSIT SKU tier** — inferred Essentials from its absence in the
   Pro/Enterprise trigger lists, not from an affirmative statement.
   Adopted: budget at Essentials, **verify against the first billing
   cycle that includes transit calls**; if it bills Pro, the §6 cost
   line doubles and the GTFS build accelerates.
4. **TTC dataset CKAN metadata says "License not specified"** — adopted:
   the portal-wide OGL–Toronto governs; attribution line carried
   unconditionally; if a dataset-specific term ever surfaces, revisit.
5. **Whether displaying a duration is "sharing" under CC-BY-SA** —
   arguable (public display vs. distribution). Adopted: treat display as
   sharing; attribution obligations honored on every surface showing an
   ORS-derived duration and on the credits page.
6. **Extraction method for HeiGIT terms** — the ToS and quota numbers
   were read out of the account app's JavaScript bundles (the rendered
   page is an SPA; WebFetch returned an empty shell). The text is
   Angular-compiled but complete and internally consistent. Risk: a
   stale bundle. Mitigation: re-verify at counsel review; the quota
   numbers additionally get verified empirically the first time the
   probe runs (429 behavior).
7. **GPL-3.0 network-use reading (self-host path only)** — adopted
   reading: serving routing over HTTP is not conveying the engine; GPL
   obligations would not reach our app code. Moot unless §3's escape
   hatch is ever taken (and it would get its own decision pass).

## Checkpoint 1 Outcome (2026-08-07) — rulings of record

1. **ODbL-for-durations reading RATIFIED as argued** (§2), with the
   ceiling hardened: the ~1,000 pairs/city limit is a **hard,
   code-enforced limit — the storage layer refuses writes beyond it.
   There is no override flag.** Breaching it requires a new decision
   pass. The no-ML rider (no training on ORS-derived rows) carries over.
2. **Storage posture (b)+(c) RATIFIED** (§6): ORS-stored
   walk/cycle/drive in a bounded, separable, CC-BY-SA-marked table;
   transit request-scoped via Google Routes and **never stored**;
   founder-measured golden pairs as tier-1 seeds; fallback chain with
   honest tier downgrade (2 → 2 → 3).
3. **TRANSIT-SKU verification trigger recorded**: the Essentials
   inference (§7 ambiguity 3) is verified against the first billing
   cycle containing transit calls. **If transit bills as Pro, the §6
   cost line doubles and the GTFS build accelerates** — that is the
   standing trigger, on the record here.
4. **E8 forward-note — attribution is per-leg and provenance-routed**:
   a travel pill on the timeline carries the HeiGIT line for
   ORS-derived durations, the Google Maps mark in-container for
   Google-fetched transit durations, and nothing for stub guesses
   (tier-3 judgment, narrated as an estimate). The credits surface
   gains the HeiGIT and OGL–Toronto lines alongside the existing FSQ
   and Open-Meteo entries.
