"use client";

/**
 * The product surface (XXX-43, Session 15).
 *
 * What it replaces, measured at CP1: one 723-line component whose first
 * screen was a fabricated test pattern with seven disabled controls, two
 * `<select>` dropdowns — one listing raw day slugs like `day-4-budget` — and
 * an uncapped stack of `[rule.id] text` lines above the day.
 *
 * Founder verdict: *"i dont want dropdowns and stuff anymore… show it to me
 * like how the app will work… no non-intuitive ways of interacting."*
 *
 * The shape is a small state machine over screens, because that is what the
 * flow is. Every engineer-facing control still exists — behind the gear.
 */

import { useState } from "react";
import { Button, Chip, Field, Label } from "@/components/ui/primitives";
import { Interview } from "./Interview";
import { Workshop } from "./Workshop";
import { DayView } from "./DayView";
import { ProfileSheet } from "./ProfileSheet";
import { Refusal } from "./Refusal";
import { EMPTY_PROFILE, type TasteProfile } from "@/shared/profile";
import { CUISINE_LABELS, type CuisineTag } from "@/shared/cuisine";
import type { ParsedDayRequest } from "@/shared/intent";
import type { TastingOutcome } from "@/shared/tasting";
import { categoryLabel, type PlaceCategory } from "@/shared/vocabulary";
import { owesLimitationNotice } from "@/shared/constraints";

type Screen =
  | { name: "gate" }
  | { name: "landing" }
  | { name: "interview" }
  | { name: "confirm"; request: ParsedDayRequest; text: string }
  | { name: "asking"; question: string; suggestions: string[]; text: string }
  | { name: "working" }
  | { name: "day"; outcome: TastingOutcome };

/** The chip rail — the common moves, in the founder's words, not ours. */
const QUICK: { label: string; text: string }[] = [
  { label: "Today", text: "a day out today" },
  { label: "This weekend", text: "a day out this weekend" },
  { label: "Outdoors", text: "somewhere outdoors" },
  { label: "Something easy", text: "an easy day, nothing packed" },
  { label: "You pick", text: "surprise me" },
];

const todayIso = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function Concierge() {
  const [screen, setScreen] = useState<Screen>({ name: "gate" });
  const [secret, setSecret] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<TasteProfile>(EMPTY_PROFILE);
  const [profileOpen, setProfileOpen] = useState(false);
  const [spent, setSpent] = useState(0);

  // Workshop state — kept here so the drawer stays a view, not an owner.
  const [personaKey, setPersonaKey] = useState("day-1-jays");
  const [personaKeys, setPersonaKeys] = useState<string[]>([]);
  const [themeKey, setThemeKey] = useState("");
  const [wsDate, setWsDate] = useState(todayIso());
  const [budget, setBudget] = useState("");
  const [lodgingOn, setLodgingOn] = useState(false);
  const [synthetic, setSynthetic] = useState(false);

  const enter = async () => {
    setError(null);
    const res = await fetch("/api/tasting/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret }),
    });
    if (res.status === 503) {
      setError("The room isn't set up on this deployment.");
      return;
    }
    if (!res.ok) {
      setError("That passphrase didn't match.");
      return;
    }
    setSecret("");
    // Persona keys are Workshop-only furniture; fetched here rather than in
    // an effect so entering the room is the single moment state loads.
    void fetch("/api/tasting/personas")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b && setPersonaKeys(b.keys as string[]))
      .catch(() => undefined);

    // A traveller who has told us nothing meets the interview first; one who
    // has is taken straight to the box.
    const p = await fetch("/api/tasting/profile").then((r) => r.json());
    const stored = p.profile as TasteProfile;
    setProfile(stored);
    const blank =
      stored.excludedCategories.length === 0 &&
      stored.lovedCuisines.length === 0 &&
      (stored.interests?.length ?? 0) === 0;
    setScreen(blank ? { name: "interview" } : { name: "landing" });
  };

  const saveProfile = async (next: TasteProfile) => {
    setProfile(next);
    await fetch("/api/tasting/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(next.interests === undefined ? {} : { interests: next.interests }),
        ...(next.pace === undefined ? {} : { pace: next.pace }),
        ...(next.foodCourage === undefined ? {} : { foodCourage: next.foodCourage }),
        ...(next.lens === undefined ? {} : { lens: next.lens }),
        ...(next.structure === undefined ? {} : { structure: next.structure }),
        excludedCategories: next.excludedCategories,
        dietary: next.dietary,
        lovedCuisines: next.lovedCuisines,
      }),
    });
  };

  /** Read the sentence. Cheap, and shown before anything is spent. */
  const readIt = async (sentence: string) => {
    setError(null);
    setScreen({ name: "working" });
    try {
      const res = await fetch("/api/tasting/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: sentence, today: todayIso() }),
      });
      if (res.status === 401) {
        setScreen({ name: "gate" });
        return;
      }
      const body = await res.json();
      setSpent((s) => s + (body.spentUsd ?? 0));
      if (body.status === "needs-clarification") {
        setScreen({
          name: "asking",
          question: body.question,
          suggestions: body.suggestions ?? [],
          text: sentence,
        });
        return;
      }
      setScreen({
        name: "confirm",
        request: body.request as ParsedDayRequest,
        text: sentence,
      });
    } catch {
      setError("Couldn't reach the concierge. Try again.");
      setScreen({ name: "landing" });
    }
  };

  const generate = async (request: ParsedDayRequest | null) => {
    setError(null);
    setScreen({ name: "working" });
    try {
      const res = await fetch("/api/tasting/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          personaKey,
          date: request?.date ?? wsDate,
          budgetMax:
            request?.budgetMax ?? (budget === "" ? null : Number(budget)),
          seed: null,
          synthetic,
          useProfile: request !== null,
          excludedCategories: request?.excludedCategories ?? [],
          lovedCuisines: request?.lovedCuisines ?? [],
          theme: themeFor(request?.theme ?? themeKey),
          lodging: lodgingOn ? { lat: 43.6517, lng: -79.3817 } : null,
        }),
      });
      if (res.status === 401) {
        setScreen({ name: "gate" });
        return;
      }
      if (!res.ok) {
        setError("That didn't work. Nothing was spent.");
        setScreen({ name: "landing" });
        return;
      }
      const outcome = (await res.json()) as TastingOutcome;
      // Only the arms that actually ran a generation carry a meter.
      if (outcome.status === "ok" || outcome.status === "failed") {
        setSpent((s) => s + (outcome.meter?.estCostUsd ?? 0));
      }
      setScreen({ name: "day", outcome });
    } catch {
      setError("Couldn't reach the concierge. Nothing was spent.");
      setScreen({ name: "landing" });
    }
  };

  /* ── gate ─────────────────────────────────────────────────────────── */
  if (screen.name === "gate") {
    return (
      <Shell>
        <div className="flex flex-col gap-7 pt-24">
          <h1 className="display text-[2.6rem]">Toronto</h1>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void enter()}
            placeholder="Passphrase"
            className="border-hair-2 text-ink placeholder:text-muted focus:border-accent w-full border-0 border-b bg-transparent pb-3 text-[1.02rem] font-light focus:outline-none"
          />
          <Button onClick={() => void enter()}>Enter</Button>
          {error && <p className="text-warn text-[0.85rem] font-light">{error}</p>}
        </div>
      </Shell>
    );
  }

  const gear = (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => setProfileOpen(true)}
        className="label-xs text-muted hover:text-ink cursor-pointer px-2 py-2"
      >
        You
      </button>
      <Workshop
        personaKey={personaKey}
        personaKeys={personaKeys}
        onPersonaKey={setPersonaKey}
        themeKey={themeKey}
        themeOptions={THEME_OPTIONS}
        onThemeKey={setThemeKey}
        date={wsDate}
        onDate={setWsDate}
        budget={budget}
        onBudget={setBudget}
        lodgingOn={lodgingOn}
        onLodging={setLodgingOn}
        synthetic={synthetic}
        onSynthetic={setSynthetic}
        onGenerate={() => void generate(null)}
        busy={screen.name === "working"}
        meter={
          <p className="text-muted font-mono text-[0.72rem]">
            session spend ${spent.toFixed(4)}
          </p>
        }
      />
    </div>
  );

  return (
    <Shell header={gear}>
      <ProfileSheet
        open={profileOpen}
        profile={profile}
        onClose={() => setProfileOpen(false)}
        onChange={(p) => void saveProfile(p)}
        onRedoInterview={() => {
          setProfileOpen(false);
          setScreen({ name: "interview" });
        }}
      />

      {screen.name === "interview" && (
        <Interview
          initial={profile}
          onDone={(p) => {
            void saveProfile(p);
            setScreen({ name: "landing" });
          }}
          onSkip={() => setScreen({ name: "landing" })}
        />
      )}

      {screen.name === "landing" && (
        <div className="flex flex-col gap-8 pt-10">
          <h1 className="display text-[2.3rem]">What&apos;s the plan?</h1>
          <Field
            value={text}
            onChange={setText}
            onSubmit={() => text.trim() && void readIt(text)}
            placeholder="Park day with friends Saturday if the weather's good, I don't drink, love Thai…"
          />
          <div className="flex flex-wrap gap-2">
            {QUICK.map((q) => (
              <Chip key={q.label} onClick={() => void readIt(q.text)}>
                {q.label}
              </Chip>
            ))}
          </div>
          <Button
            onClick={() => text.trim() && void readIt(text)}
            disabled={text.trim().length === 0}
          >
            Plan it
          </Button>
          {error && <p className="text-warn text-[0.85rem] font-light">{error}</p>}
        </div>
      )}

      {screen.name === "asking" && (
        <div className="flex flex-col gap-7 pt-10">
          <h2 className="display text-[1.6rem]">{screen.question}</h2>
          <div className="flex flex-wrap gap-2">
            {screen.suggestions.map((s) => (
              <Chip
                key={s}
                onClick={() => void readIt(`${screen.text} — ${s}`)}
              >
                {s}
              </Chip>
            ))}
          </div>
          <Button variant="ghost" onClick={() => setScreen({ name: "landing" })}>
            Start over
          </Button>
        </div>
      )}

      {screen.name === "confirm" && (
        <ConfirmChips
          request={screen.request}
          text={screen.text}
          onChange={(r) => setScreen({ ...screen, request: r })}
          onGo={() => void generate(screen.request)}
          onBack={() => setScreen({ name: "landing" })}
        />
      )}

      {screen.name === "working" && (
        <div className="flex flex-col gap-4 pt-24">
          <Label>Working</Label>
          <p className="display text-[1.5rem]">Putting a day together.</p>
          <p className="text-muted text-[0.85rem] font-light">
            Ten to fifteen seconds.
          </p>
        </div>
      )}

      {screen.name === "day" && screen.outcome.status === "ok" && (
        <DayView
          outcome={screen.outcome}
          onNew={() => setScreen({ name: "landing" })}
          dietaryStated={profile.dietary.length > 0}
          constrained={owesLimitationNotice(profile.excludedCategories)}
        />
      )}

      {screen.name === "day" && screen.outcome.status !== "ok" && (
        <Refusal
          outcome={screen.outcome}
          onRetry={() => setScreen({ name: "landing" })}
        />
      )}
    </Shell>
  );
}

/* ── the confirmation chips — the honesty law, as UI ─────────────────── */

function ConfirmChips({
  request,
  text,
  onChange,
  onGo,
  onBack,
}: {
  request: ParsedDayRequest;
  text: string;
  onChange: (r: ParsedDayRequest) => void;
  onGo: () => void;
  onBack: () => void;
}) {
  const drop = (patch: Partial<ParsedDayRequest>) =>
    onChange({ ...request, ...patch });

  return (
    <div className="flex flex-col gap-7 pt-10">
      <Label>Check</Label>
      <p className="text-ink text-[1.02rem] font-light">{text}</p>
      <p className="text-muted text-[0.82rem] font-light">
        Drop anything I got wrong.
      </p>
      <div className="flex flex-wrap gap-2">
        {request.date !== null && (
          <Chip on onRemove={() => drop({ date: null })}>
            {request.date}
          </Chip>
        )}
        {request.party !== null && (
          <Chip on onRemove={() => drop({ party: null })}>
            {request.party}
          </Chip>
        )}
        {request.weatherConditional && (
          <Chip on onRemove={() => drop({ weatherConditional: false })}>
            Only if it&apos;s fine
          </Chip>
        )}
        {request.budgetMax !== null && (
          <Chip on onRemove={() => drop({ budgetMax: null })}>
            Under ${request.budgetMax}
          </Chip>
        )}
        {request.excludedCategories.map((c: PlaceCategory) => (
          <Chip
            key={c}
            on
            onRemove={() =>
              drop({
                excludedCategories: request.excludedCategories.filter(
                  (x) => x !== c,
                ),
              })
            }
          >
            No {categoryLabel(c)}
          </Chip>
        ))}
        {request.lovedCuisines.map((c: CuisineTag) => (
          <Chip
            key={c}
            on
            onRemove={() =>
              drop({
                lovedCuisines: request.lovedCuisines.filter((x) => x !== c),
              })
            }
          >
            {CUISINE_LABELS[c]}
          </Chip>
        ))}
      </div>
      <Button onClick={onGo}>Plan it</Button>
      <Button variant="ghost" onClick={onBack}>
        Change what I said
      </Button>
    </div>
  );
}

/* ── shell ───────────────────────────────────────────────────────────── */

function Shell({
  children,
  header,
}: {
  children: React.ReactNode;
  header?: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col px-6 pb-24">
      {header && (
        <div className="flex justify-end pt-4">{header}</div>
      )}
      {children}
    </main>
  );
}

const THEME_OPTIONS = [
  { key: "", label: "Concierge's choice" },
  { key: "venue", label: "One place" },
  { key: "thread:history-of-toronto", label: "History" },
  { key: "experience:toronto-islands", label: "Islands" },
];

/** Theme key → the engine's discriminated union. */
function themeFor(key: string | null) {
  if (key === null || key === "") return null;
  if (key === "venue") return { mode: "venue" as const };
  if (key.startsWith("thread:")) {
    return { mode: "thread" as const, threadId: key.slice(7) };
  }
  if (key.startsWith("experience:")) {
    return { mode: "experience" as const, experienceId: key.slice(11) };
  }
  return null;
}

