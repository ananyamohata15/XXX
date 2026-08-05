import {
  lookupTravel,
  timeToMinutes,
  type FixtureDay,
  type PlaceView,
} from "@/shared/timeline";
import { CITY_LABELS } from "@/shared/vocabulary";
import { SlotCard } from "./SlotCard";
import { TravelSegment } from "./TravelSegment";
import { formatDayDate } from "./format";

/** Gaps shorter than this are travel slack, not free time worth naming. */
const FREE_TIME_THRESHOLD_MINUTES = 40;

function mustGetPlace(day: FixtureDay, id: string): PlaceView {
  const place = day.places[id];
  if (!place) throw new Error(`fixture invariant broken: unknown place "${id}"`);
  return place;
}

export function TimelineBoard({ day }: { day: FixtureDay }) {
  const first = day.slots[0];
  const last = day.slots[day.slots.length - 1];

  return (
    <div className="mx-auto w-full max-w-md px-4 pb-16 pt-8">
      <header className="mb-6 px-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
          {CITY_LABELS[day.city]}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {formatDayDate(day.date)}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {day.slots.length} stops · {first.startTime}–{last.endTime}
        </p>
      </header>

      <ol className="flex flex-col">
        {day.slots.map((slot, i) => {
          const next = day.slots[i + 1];
          const leg = next
            ? lookupTravel(day.travel, slot.placeId, next.placeId)
            : null;
          const gapMinutes = next
            ? timeToMinutes(next.startTime) -
              timeToMinutes(slot.endTime) -
              (leg?.minutes ?? 0)
            : 0;
          return (
            <li key={slot.id} className="flex flex-col">
              <SlotCard
                slot={slot}
                place={mustGetPlace(day, slot.placeId)}
                alternateNames={slot.alternates.map(
                  (a) => mustGetPlace(day, a.placeId).name,
                )}
              />
              {next && (
                <TravelSegment
                  leg={leg}
                  freeMinutes={
                    gapMinutes >= FREE_TIME_THRESHOLD_MINUTES ? gapMinutes : 0
                  }
                />
              )}
            </li>
          );
        })}
      </ol>

      <footer className="mt-8 space-y-2 px-1 text-xs text-zinc-400 dark:text-zinc-500">
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
            Verified
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
            Observed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-violet-500" aria-hidden />
            Judgment
          </span>
        </p>
        <p>
          Travel times: Google Routes (fixture). Prototype — hand-authored
          data, nothing fetched.
        </p>
      </footer>
    </div>
  );
}
