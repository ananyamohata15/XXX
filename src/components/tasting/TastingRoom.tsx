"use client";

import { useEffect, useRef, useState } from "react";
import { InteractiveTimeline } from "@/components/timeline/InteractiveTimeline";
import { GOLDEN_PERSONAS } from "@/shared/persona";
import type { TastingOutcome } from "@/shared/tasting";
import { Meter } from "./Meter";
import { VerdictControls } from "./VerdictControls";

/**
 * The founder's tasting room (XXX-32).
 *
 * A page with one job: put a real generated day in front of the most
 * qualified referee we have, with every fact's provenance visible, and
 * take their verdict. Everything on it is either the day, the evidence
 * behind the day, or a control for judging it.
 *
 * The timeline is the REAL Session-3 component in `review` mode: tap for
 * provenance, no reorder, no swap. The argument for that is in
 * InteractiveCard — reflowDay is deliberately naive, so a drag here
 * would render a grammar-violating day with the authority of a
 * validated one, on the page whose entire purpose is judging validity.
 */

const PERSONA_KEYS = Object.keys(GOLDEN_PERSONAS);

/**
 * The pipeline's known sequence with Session 9's measured timings. It is
 * NOT live telemetry — the response arrives whole (skeleton-then-full
 * was the CP1 ruling; XXX-20 inherits streaming). Marked "≈" so nobody
 * reads it as progress it is not.
 */
const STAGES: { label: string; atMs: number }[] = [
  { label: "Retrieving candidates from the pool", atMs: 0 },
  { label: "Linking and fetching hours from Google", atMs: 900 },
  { label: "Filtering on facts, scoring, choosing", atMs: 2600 },
  { label: "Composing the day and pricing travel", atMs: 8000 },
  { label: "Validating against the day grammar", atMs: 8500 },
  { label: "Writing the reasons", atMs: 9000 },
];

/** A random near-future date, which is what "vet something new" means. */
function randomNearFutureDate(): string {
  const days = 3 + Math.floor(Math.random() * 43);
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function Skeleton({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = window.setInterval(
      () => setElapsed(Date.now() - startedAt),
      100,
    );
    return () => window.clearInterval(id);
  }, [startedAt]);

  const current = STAGES.reduce(
    (acc, s, i) => (elapsed >= s.atMs ? i : acc),
    0,
  );

  return (
    <div className="mx-auto w-full max-w-md px-4 pt-8">
      <p className="font-mono text-3xl tabular-nums text-zinc-900 dark:text-zinc-50">
        {(elapsed / 1000).toFixed(1)}s
      </p>
      <ol className="mt-4 space-y-1.5">
        {STAGES.map((stage, i) => (
          <li
            key={stage.label}
            className={`text-sm ${
              i === current
                ? "text-zinc-900 dark:text-zinc-50"
                : i < current
                  ? "text-zinc-400 dark:text-zinc-500"
                  : "text-zinc-300 dark:text-zinc-600"
            }`}
          >
            {i < current ? "· " : i === current ? "≈ " : "  "}
            {stage.label}
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
        Stages are the pipeline&apos;s known sequence with Session 9 timings,
        not live telemetry — the response arrives whole. Typical: 10–15s.
      </p>
      <div className="mt-6 space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800"
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Attribution is conditional on what actually contributed to THIS day
 * (docs 001/003): the marks appear in-container, next to the data they
 * cover, and only when that provider is in the sources list.
 */
function Attribution({ sources }: { sources: string[] }) {
  const google = sources.some((s) => s.startsWith("google"));
  const ors = sources.includes("openrouteservice");
  return (
    <>
      {google && (
        <p>
          Hours, status, prices and transit times:{" "}
          <span className="font-medium text-zinc-500 dark:text-zinc-400">
            Google Maps
          </span>
          . Fetched per request and never stored.
        </p>
      )}
      {ors && (
        <p>
          Walking and cycling times: OpenRouteService, © openrouteservice.org
          by HeiGIT | Map data © OpenStreetMap contributors.
        </p>
      )}
      {sources.includes("synthetic_preview") && (
        <p>Synthetic facts — no provider was called for this day.</p>
      )}
    </>
  );
}

function Gate({ onOpen }: { onOpen: () => void }) {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/tasting/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          response.status === 503
            ? "The room is not configured on this deployment."
            : (body.error ?? "Not recognised."),
        );
      }
      // The secret is now a server-set httpOnly cookie; drop our copy.
      setSecret("");
      onOpen();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Tasting room
      </h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Founder instrument. Nothing here is public.
      </p>
      <input
        type="password"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
        }}
        autoComplete="off"
        placeholder="Passphrase"
        className="mt-6 w-full rounded-xl border border-zinc-200 bg-white p-3 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      />
      <button
        type="button"
        disabled={busy || secret === ""}
        onClick={() => void submit()}
        className="mt-3 rounded-xl bg-zinc-900 p-3 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {busy ? "Checking…" : "Enter"}
      </button>
      {error && (
        <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>
      )}
    </div>
  );
}

export function TastingRoom() {
  const [open, setOpen] = useState(false);
  const [personaKey, setPersonaKey] = useState(PERSONA_KEYS[0]);
  const [date, setDate] = useState("");
  const [budget, setBudget] = useState("");
  const [synthetic, setSynthetic] = useState(true);
  const [busyAt, setBusyAt] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<TastingOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dayNote, setDayNote] = useState("");
  const [dayNoteSent, setDayNoteSent] = useState<string | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);

  const generate = async () => {
    setBusyAt(Date.now());
    setError(null);
    setOutcome(null);
    setDayNoteSent(null);
    try {
      const response = await fetch("/api/tasting/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          personaKey:
            personaKey === "__random"
              ? PERSONA_KEYS[Math.floor(Math.random() * PERSONA_KEYS.length)]
              : personaKey,
          date,
          budgetMax: budget === "" ? null : Number(budget),
          seed: null,
          synthetic,
        }),
      });
      const body = await response.json();
      if (response.status === 401) {
        setOpen(false);
        throw new Error("Session expired — enter the passphrase again.");
      }
      if (!response.ok && response.status !== 429) {
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      setOutcome(body as TastingOutcome);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyAt(null);
    }
  };

  const sendDayVerdict = async () => {
    if (outcome === null || outcome.status !== "ok") return;
    try {
      const response = await fetch("/api/tasting/taste", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          traceId: outcome.meter.traceId,
          signal: "day_verdict",
          freeText: dayNote.trim(),
        }),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      setDayNoteSent("Day verdict recorded.");
      setDayNote("");
    } catch (err) {
      setDayNoteSent((err as Error).message);
    }
  };

  if (!open) {
    // The date is randomised on entry rather than at mount: an event
    // handler, so the server and the client never disagree about what
    // "random" was, and no effect has to correct the first render.
    return (
      <Gate
        onOpen={() => {
          setDate(randomNearFutureDate());
          setOpen(true);
        }}
      />
    );
  }

  return (
    <div className="pb-20">
      <div ref={controlsRef} className="mx-auto w-full max-w-md px-4 pt-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Tasting room
        </h1>

        <div className="mt-4 space-y-2.5">
          <select
            value={personaKey}
            disabled={synthetic}
            onChange={(e) => setPersonaKey(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-white p-3 text-sm disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
          >
            {PERSONA_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
            <option value="__random">Random persona</option>
          </select>
          <div className="flex gap-2.5">
            <input
              type="date"
              value={date}
              disabled={synthetic}
              onChange={(e) => setDate(e.target.value)}
              className="flex-1 rounded-xl border border-zinc-200 bg-white p-3 text-sm disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
            />
            <button
              type="button"
              disabled={synthetic}
              onClick={() => setDate(randomNearFutureDate())}
              className="rounded-xl border border-zinc-200 px-3 text-sm text-zinc-500 disabled:cursor-not-allowed disabled:text-zinc-300 dark:border-zinc-700 dark:text-zinc-400 dark:disabled:text-zinc-600"
            >
              Random
            </button>
          </div>
          <input
            type="number"
            inputMode="numeric"
            value={budget}
            disabled={synthetic}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="Budget cap in CAD (optional)"
            className="w-full rounded-xl border border-zinc-200 bg-white p-3 text-sm disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
          />
          {/* Inert controls must LOOK inert. A picker that silently does
              nothing reads as a broken page, whatever the design says. */}
          {synthetic && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              Persona, date and budget are disabled: the test pattern is a
              fixed set of cards and does not compose a day from them.
            </p>
          )}
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={synthetic}
              onChange={(e) => setSynthetic(e.target.checked)}
            />
            Display test pattern (free, spends no quota)
          </label>
          <button
            type="button"
            disabled={busyAt !== null || date === ""}
            onClick={() => void generate()}
            className="w-full rounded-xl bg-zinc-900 p-3 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {busyAt !== null ? "Generating…" : "Generate"}
          </button>
        </div>

        {error && (
          <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>
        )}
      </div>

      {busyAt !== null && <Skeleton startedAt={busyAt} />}

      {outcome?.status === "capped" && (
        <div className="mx-auto mt-6 w-full max-w-md px-4">
          <div className="rounded-2xl border border-amber-300 p-4 text-sm text-amber-700 dark:border-amber-800 dark:text-amber-400">
            <p>
              Daily cap reached: {outcome.quota.generationsToday} of{" "}
              {outcome.quota.dailyCap}. Resets{" "}
              {new Date(outcome.quota.resetsAt).toLocaleString()}.
            </p>
            <p className="mt-1.5 text-xs">
              {outcome.note} Raise it at{" "}
              <code className="font-mono">{outcome.raiseAt}</code>.
            </p>
          </div>
        </div>
      )}

      {outcome?.status === "failed" && (
        <div className="mx-auto mt-6 w-full max-w-md space-y-3 px-4">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {outcome.headline}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            The grammar loop could not land a legal day. It was not shipped —
            you are seeing the refusal, which is the point.
          </p>
          {outcome.violations.map((v) => (
            <p key={v.ruleId} className="text-sm text-rose-700 dark:text-rose-400">
              [{v.ruleId}] {v.text}
            </p>
          ))}
          <Meter meter={outcome.meter} synthetic={false} />
        </div>
      )}

      {outcome?.status === "ok" && (
        <>
          {outcome.synthetic && (
            <div className="mx-auto mt-6 w-full max-w-md px-4">
              <div className="rounded-2xl border-2 border-dashed border-amber-400 p-3 text-sm text-amber-700 dark:text-amber-400">
                <p>
                  <strong>Display test pattern — not a composed itinerary.</strong>{" "}
                  Uncheck &ldquo;Display test pattern&rdquo; above to generate a
                  real day.
                </p>
                <p className="mt-1.5 text-xs">
                  Real venues from the pool wearing fabricated facts and times,
                  here to exercise every rendering path at once. Verdicts are
                  recorded but write no ground truth.
                </p>
              </div>
            </div>
          )}

          <div className="mx-auto mt-6 w-full max-w-md space-y-2 px-4">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {outcome.headline}
            </p>
            {outcome.dayNotes.map((note) => (
              <p key={note} className="text-sm text-zinc-600 dark:text-zinc-300">
                {note}
              </p>
            ))}
            {outcome.advisories.map((a) => (
              <p
                key={a.ruleId + a.text}
                className="text-xs text-amber-700 dark:text-amber-500"
              >
                [{a.ruleId}] {a.text}
              </p>
            ))}
            {outcome.unfilled.map((u) => (
              <p
                key={u.label}
                className="text-xs text-zinc-500 dark:text-zinc-400"
              >
                Unfilled: {u.label} ({u.cause}) — a thinner day, said out loud.
              </p>
            ))}
          </div>

          <div className="mx-auto mt-5 w-full max-w-md px-4">
            <p className="rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              Read-only view — this page is for judging days, not arranging
              them. Tap a card for provenance; editing unlocks with E5.
            </p>
          </div>

          <InteractiveTimeline
            day={outcome.day}
            interactivity="review"
            renderSlotFooter={(slot) => (
              <VerdictControls
                traceId={outcome.meter.traceId}
                slotId={slot.id}
              />
            )}
            footerNote={<Attribution sources={outcome.sources} />}
          />

          <div className="mx-auto w-full max-w-md px-4">
            <section className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
                The day as a whole
              </h2>
              <textarea
                value={dayNote}
                onChange={(e) => setDayNote(e.target.value)}
                rows={3}
                placeholder="Morning perfect, evening felt like a brochure…"
                className="mt-2 w-full rounded-xl border border-zinc-200 bg-white p-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  disabled={dayNote.trim() === ""}
                  onClick={() => void sendDayVerdict()}
                  className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Send day verdict
                </button>
                {dayNoteSent && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {dayNoteSent}
                  </span>
                )}
              </div>
            </section>

            <Meter meter={outcome.meter} synthetic={outcome.synthetic} />

            <button
              type="button"
              onClick={() => {
                controlsRef.current?.scrollIntoView({ behavior: "smooth" });
              }}
              className="mt-6 w-full rounded-xl border border-zinc-200 p-3 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
            >
              Back to controls
            </button>
          </div>
        </>
      )}
    </div>
  );
}
