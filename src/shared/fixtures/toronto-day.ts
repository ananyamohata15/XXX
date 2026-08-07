import { fixtureDaySchema, travelKey, type FixtureDay } from "../timeline";
import { TIERS, type Tier } from "../vocabulary";

/**
 * The fixture Toronto Saturday (XXX-18). Every value here is hand-authored
 * placeholder data — nothing was fetched. Source names indicate what the
 * real pipeline would cite for a value of that kind (google_places,
 * google_routes, concierge), so the provenance chips render as they will in
 * production; fetchedAt is one fixed timestamp for the whole file.
 *
 * Deliberate content choices, per the approved Step 1 plan:
 * - El Catrín is the user's own booking: origin "user", no reason, no
 *   alternates, immovable at 19:00.
 * - By the Way Cafe's price is status "absent": we looked, it isn't
 *   published. Displayed as missing, never guessed.
 * - Distillery District is known-free: min = max = 0, not absent.
 * - The 16:30–17:15 gap is on purpose — a day needs air. St. Lawrence
 *   Market's Saturday 17:00 close is a real published constraint the
 *   timing has to respect (golden-set lesson #1: dwell-time plausibility).
 * - The travel matrix covers all main-slot pairs plus each alternate to its
 *   default-order neighbours. Pairs that drag-plus-swap can produce beyond
 *   that are honestly absent ("travel not computed"), matching how the real
 *   product behaves before a route is fetched.
 */

const AT = "2026-08-01T09:00:00-04:00";

const present = <T,>(value: T, source: string, tier: Tier) => ({
  status: "present" as const,
  value,
  source,
  tier,
  fetchedAt: AT,
});
const absent = (source: string, tier: Tier) => ({
  status: "absent" as const,
  source,
  tier,
  fetchedAt: AT,
});
const because = (text: string) => ({
  text,
  source: "concierge",
  tier: TIERS.judgment,
});
const cad = (min: number, max: number) => ({ min, max, currency: "CAD" });

const rawDay = {
  city: "toronto",
  date: "2026-08-15",
  dayStart: "08:30",
  places: {
    mildreds: {
      id: "mildreds",
      name: "Mildred's Temple Kitchen",
      neighborhood: "Liberty Village",
      priceRange: present(cad(25, 45), "google_places", TIERS.observed),
      hoursToday: present("Sat 8:00–14:00", "google_places", TIERS.verified),
      vibe: present(
        "Sunlit Liberty Village room; the ricotta pancakes are the order.",
        "concierge",
        TIERS.judgment,
      ),
    },
    mahas: {
      id: "mahas",
      name: "Maha's Egyptian Brunch",
      neighborhood: "Leslieville",
      priceRange: present(cad(18, 30), "google_places", TIERS.observed),
      hoursToday: present("Sat 8:00–15:00", "google_places", TIERS.verified),
      vibe: present(
        "Family-run and homey; the cardamom coffee alone justifies the trip east.",
        "concierge",
        TIERS.judgment,
      ),
    },
    school: {
      id: "school",
      name: "School Restaurant",
      neighborhood: "Liberty Village",
      priceRange: present(cad(20, 40), "google_places", TIERS.observed),
      hoursToday: present("Sat 9:00–15:00", "google_places", TIERS.verified),
      vibe: present(
        "Big room, big menu — the easy call for groups.",
        "concierge",
        TIERS.judgment,
      ),
    },
    rom: {
      id: "rom",
      name: "Royal Ontario Museum",
      neighborhood: "Bloor & Avenue Rd",
      priceRange: present(cad(26, 26), "rom.on.ca", TIERS.verified),
      hoursToday: present("10:00–17:30", "rom.on.ca", TIERS.verified),
      vibe: present(
        "Start in the dinosaur halls before the school groups land.",
        "concierge",
        TIERS.judgment,
      ),
    },
    ago: {
      id: "ago",
      name: "Art Gallery of Ontario",
      neighborhood: "Grange Park",
      priceRange: present(cad(30, 30), "ago.ca", TIERS.verified),
      hoursToday: present("10:30–17:00", "ago.ca", TIERS.verified),
      vibe: present(
        "Gehry's spiral staircase and the best Canadian collection anywhere.",
        "concierge",
        TIERS.judgment,
      ),
    },
    gardiner: {
      id: "gardiner",
      name: "Gardiner Museum",
      neighborhood: "Bloor & Avenue Rd",
      priceRange: present(cad(15, 15), "gardinermuseum.on.ca", TIERS.verified),
      hoursToday: present("10:00–17:00", "gardinermuseum.on.ca", TIERS.verified),
      vibe: present(
        "An hour of ceramics in perfect calm — the quiet counterpoint to the ROM.",
        "concierge",
        TIERS.judgment,
      ),
    },
    "by-the-way": {
      id: "by-the-way",
      name: "By the Way Cafe",
      neighborhood: "The Annex",
      // We looked; it isn't published. Shown as missing, never guessed.
      priceRange: absent("google_places", TIERS.observed),
      hoursToday: present("11:00–22:00", "google_places", TIERS.observed),
      vibe: present(
        "Annex falafel institution; scuffed, quick, exactly right after a museum.",
        "concierge",
        TIERS.judgment,
      ),
    },
    fresh: {
      id: "fresh",
      name: "Fresh on Bloor",
      neighborhood: "The Annex",
      priceRange: present(cad(15, 25), "google_places", TIERS.observed),
      hoursToday: present("11:00–21:00", "google_places", TIERS.verified),
      vibe: present(
        "Dependable vegan bowls, zero wait anxiety.",
        "concierge",
        TIERS.judgment,
      ),
    },
    "sushi-on-bloor": {
      id: "sushi-on-bloor",
      name: "Sushi on Bloor",
      neighborhood: "The Annex",
      priceRange: absent("google_places", TIERS.observed),
      hoursToday: present("11:30–22:00", "google_places", TIERS.verified),
      vibe: present(
        "Cheap, fast, busy — the Annex lunch default.",
        "concierge",
        TIERS.judgment,
      ),
    },
    "st-lawrence-market": {
      id: "st-lawrence-market",
      name: "St. Lawrence Market",
      neighborhood: "Old Town",
      priceRange: present(cad(0, 0), "stlawrencemarket.com", TIERS.verified),
      // The 17:00 Saturday close is the fact that forces this slot's timing.
      hoursToday: present("Sat 5:00–17:00", "stlawrencemarket.com", TIERS.verified),
      vibe: present(
        "Peameal bacon sandwich from Carousel Bakery — the city's canonical bite.",
        "concierge",
        TIERS.judgment,
      ),
    },
    chinatown: {
      id: "chinatown",
      name: "Chinatown",
      neighborhood: "Spadina & Dundas",
      priceRange: present(cad(0, 0), "concierge", TIERS.judgment),
      hoursToday: present("Open streets — busiest 12:00–18:00", "concierge", TIERS.judgment),
      vibe: present(
        "Produce stalls, BBQ windows, and bakery counters — graze as you go.",
        "concierge",
        TIERS.judgment,
      ),
    },
    "graffiti-alley": {
      id: "graffiti-alley",
      name: "Graffiti Alley",
      neighborhood: "Queen West",
      priceRange: present(cad(0, 0), "concierge", TIERS.judgment),
      hoursToday: present("Always open", "concierge", TIERS.judgment),
      vibe: present(
        "Rush Lane's rotating murals — a block-long argument about art.",
        "concierge",
        TIERS.judgment,
      ),
    },
    distillery: {
      id: "distillery",
      name: "Distillery Historic District",
      neighborhood: "Old Town East",
      // Known-free is a value, not an absence: min = max = 0.
      priceRange: present(cad(0, 0), "thedistillerydistrict.com", TIERS.verified),
      hoursToday: present("10:00–19:00", "google_places", TIERS.observed),
      vibe: present(
        "Cobblestones, galleries, no cars; best light after four.",
        "concierge",
        TIERS.judgment,
      ),
    },
    kensington: {
      id: "kensington",
      name: "Kensington Market",
      neighborhood: "Kensington",
      priceRange: present(cad(0, 0), "concierge", TIERS.judgment),
      hoursToday: present("Open streets — vendors 11:00–19:00", "concierge", TIERS.judgment),
      vibe: present(
        "Scruffier and livelier — better people-watching, worse on a hot afternoon.",
        "concierge",
        TIERS.judgment,
      ),
    },
    harbourfront: {
      id: "harbourfront",
      name: "Harbourfront Centre",
      neighborhood: "Waterfront",
      priceRange: present(cad(0, 0), "harbourfrontcentre.com", TIERS.verified),
      hoursToday: present("10:00–21:00", "harbourfrontcentre.com", TIERS.verified),
      vibe: present(
        "Lake breeze and free galleries; slower pace than downtown.",
        "concierge",
        TIERS.judgment,
      ),
    },
    "el-catrin": {
      id: "el-catrin",
      name: "El Catrín Destilería",
      neighborhood: "Distillery District",
      priceRange: present(cad(40, 90), "google_places", TIERS.observed),
      hoursToday: present("Sat 11:00–23:00", "elcatrin.ca", TIERS.verified),
      vibe: present(
        "Floor-to-ceiling murals and a mezcal list with opinions.",
        "concierge",
        TIERS.judgment,
      ),
    },
  },
  slots: [
    {
      id: "slot-brunch",
      origin: "concierge",
      kind: "meal",
      startTime: "08:30",
      endTime: "09:45",
      placeId: "mildreds",
      reason: because(
        "Their ricotta pancakes are worth the early start — and Liberty Village is dead quiet on Saturday mornings.",
      ),
      alternates: [
        {
          placeId: "mahas",
          rank: 1,
          reason: because(
            "Egyptian brunch with a cult following — heavier, homier, cash-friendly.",
          ),
        },
        {
          placeId: "school",
          rank: 2,
          reason: because(
            "Same neighbourhood, bigger menu, easier with a group.",
          ),
        },
      ],
    },
    {
      id: "slot-museum",
      origin: "concierge",
      kind: "activity",
      startTime: "10:15",
      endTime: "12:45",
      placeId: "rom",
      reason: because(
        "Rain likely until noon — the ROM soaks up a wet morning, and it's quietest right at open.",
      ),
      alternates: [
        {
          placeId: "ago",
          rank: 1,
          reason: because("Also indoors; stronger on modern art than dinosaurs."),
        },
        {
          placeId: "gardiner",
          rank: 2,
          reason: because(
            "Small and calm — ceramics across the street; an hour, not a morning.",
          ),
        },
      ],
    },
    {
      id: "slot-lunch",
      origin: "concierge",
      kind: "meal",
      startTime: "13:00",
      endTime: "14:00",
      placeId: "by-the-way",
      reason: because(
        "Nine minutes' walk from the museum, and the falafel plate earns the detour.",
      ),
      alternates: [
        {
          placeId: "fresh",
          rank: 1,
          reason: because("Reliable vegan bowls when the queue next door is long."),
        },
        {
          placeId: "sushi-on-bloor",
          rank: 2,
          reason: because("Cheap, fast, and right on the strip."),
        },
      ],
    },
    {
      id: "slot-market",
      origin: "concierge",
      kind: "activity",
      startTime: "15:00",
      endTime: "16:30",
      placeId: "st-lawrence-market",
      reason: because(
        "Saturday is the market's big day and it closes at five — this window catches the stalls alive but past the midday crush.",
      ),
      alternates: [
        {
          placeId: "kensington",
          rank: 1,
          reason: because(
            "Same grazing instinct, scruffier streets — and it doesn't close at five.",
          ),
        },
        {
          placeId: "chinatown",
          rank: 2,
          reason: because(
            "Bakeries and BBQ windows along Spadina — cheaper, louder, open late.",
          ),
        },
      ],
    },
    {
      id: "slot-distillery",
      origin: "concierge",
      kind: "activity",
      startTime: "17:15",
      endTime: "19:00",
      placeId: "distillery",
      reason: because(
        "Car-free cobblestones and galleries in the best light of the day — and dinner is already inside it.",
      ),
      alternates: [
        {
          placeId: "graffiti-alley",
          rank: 1,
          reason: because(
            "Rawer than the cobblestones — an open-air gallery that photographs even better.",
          ),
        },
        {
          placeId: "harbourfront",
          rank: 2,
          reason: because(
            "Lake air and free galleries if you'd rather be by the water.",
          ),
        },
      ],
    },
    {
      id: "slot-dinner",
      origin: "user",
      kind: "meal",
      startTime: "19:00",
      endTime: "21:00",
      placeId: "el-catrin",
      reason: null,
      alternates: [],
    },
  ],
  travel: {
    // Main-slot pairs — full symmetric coverage of the six main places.
    [travelKey("mildreds", "rom")]: { mode: "transit", minutes: 26 },
    [travelKey("mildreds", "by-the-way")]: { mode: "transit", minutes: 24 },
    [travelKey("mildreds", "st-lawrence-market")]: { mode: "transit", minutes: 28 },
    [travelKey("mildreds", "distillery")]: { mode: "transit", minutes: 33 },
    [travelKey("mildreds", "el-catrin")]: { mode: "transit", minutes: 34 },
    [travelKey("rom", "by-the-way")]: { mode: "walk", minutes: 9 },
    [travelKey("rom", "st-lawrence-market")]: { mode: "transit", minutes: 22 },
    [travelKey("rom", "distillery")]: { mode: "transit", minutes: 28 },
    [travelKey("rom", "el-catrin")]: { mode: "transit", minutes: 30 },
    [travelKey("by-the-way", "st-lawrence-market")]: { mode: "transit", minutes: 35 },
    [travelKey("by-the-way", "distillery")]: { mode: "transit", minutes: 31 },
    [travelKey("by-the-way", "el-catrin")]: { mode: "transit", minutes: 32 },
    [travelKey("st-lawrence-market", "distillery")]: { mode: "walk", minutes: 15 },
    [travelKey("st-lawrence-market", "el-catrin")]: { mode: "walk", minutes: 18 },
    [travelKey("distillery", "el-catrin")]: { mode: "walk", minutes: 4 },
    // Each alternate to its slot's default-order neighbours.
    [travelKey("mahas", "rom")]: { mode: "transit", minutes: 29 },
    [travelKey("school", "rom")]: { mode: "transit", minutes: 27 },
    [travelKey("mildreds", "ago")]: { mode: "transit", minutes: 18 },
    [travelKey("ago", "by-the-way")]: { mode: "transit", minutes: 14 },
    [travelKey("mildreds", "gardiner")]: { mode: "transit", minutes: 25 },
    [travelKey("gardiner", "by-the-way")]: { mode: "walk", minutes: 11 },
    [travelKey("rom", "fresh")]: { mode: "walk", minutes: 8 },
    [travelKey("fresh", "distillery")]: { mode: "transit", minutes: 30 },
    [travelKey("rom", "sushi-on-bloor")]: { mode: "walk", minutes: 10 },
    [travelKey("sushi-on-bloor", "distillery")]: { mode: "transit", minutes: 31 },
    [travelKey("by-the-way", "kensington")]: { mode: "transit", minutes: 15 },
    [travelKey("kensington", "distillery")]: { mode: "transit", minutes: 22 },
    [travelKey("kensington", "el-catrin")]: { mode: "transit", minutes: 26 },
    [travelKey("by-the-way", "chinatown")]: { mode: "transit", minutes: 12 },
    [travelKey("chinatown", "distillery")]: { mode: "transit", minutes: 24 },
    [travelKey("st-lawrence-market", "graffiti-alley")]: { mode: "transit", minutes: 16 },
    [travelKey("graffiti-alley", "el-catrin")]: { mode: "transit", minutes: 25 },
    [travelKey("st-lawrence-market", "harbourfront")]: { mode: "transit", minutes: 17 },
    [travelKey("by-the-way", "harbourfront")]: { mode: "transit", minutes: 25 },
    [travelKey("harbourfront", "el-catrin")]: { mode: "transit", minutes: 18 },
  },
  travelProvenance: {
    source: "google_routes",
    tier: TIERS.observed,
    fetchedAt: AT,
  },
} satisfies FixtureDay;

/** Parsed at module load — a malformed fixture fails the build loudly. */
export const torontoDay: FixtureDay = fixtureDaySchema.parse(rawDay);
