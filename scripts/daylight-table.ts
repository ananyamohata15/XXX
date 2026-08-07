/**
 * Prints computed daylight for a list of dates — the table the golden-set
 * fixtures are authored from (XXX-5 / XXX-26).
 *
 * Read-only and offline: pure ephemeris via src/server/weather/ephemeris.ts
 * (astronomy-engine), no database, no network, no cost. Fixtures hard-code
 * these values because src/shared may not import src/server; the fixture
 * test re-derives them through computeDaylight and asserts equality, so a
 * pasted value cannot drift from the ephemeris unnoticed.
 *
 * Usage: npx tsx scripts/daylight-table.ts toronto 2026-06-27 2027-01-06
 */

import { computeDaylight } from "../src/server/weather/ephemeris";
import { CITIES, type City } from "../src/shared/vocabulary";

const [cityArg, ...dates] = process.argv.slice(2);

if (!CITIES.includes(cityArg as City) || dates.length === 0) {
  console.error(
    `usage: npx tsx scripts/daylight-table.ts <${CITIES.join("|")}> <YYYY-MM-DD...>`,
  );
  process.exit(1);
}

const city = cityArg as City;

for (const date of dates) {
  const d = computeDaylight(city, date);
  console.log(
    JSON.stringify({
      date: d.date,
      timezone: d.timezone,
      civilDawnLocal: d.civilDawnLocal,
      sunriseLocal: d.sunriseLocal,
      goldenHourAmEndLocal: d.goldenHourAmEndLocal,
      goldenHourPmStartLocal: d.goldenHourPmStartLocal,
      sunsetLocal: d.sunsetLocal,
      civilDuskLocal: d.civilDuskLocal,
    }),
  );
}
