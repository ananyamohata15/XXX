"use client";

import { useState } from "react";
import {
  CLAIM_LABELS,
  EVIDENCE_CLAIMS,
  type EvidenceClaim,
} from "@/shared/feedback";
import type { EvidenceResultView } from "@/shared/tasting";

/**
 * The founder's verdict on one card (XXX-32 + comment 10296).
 *
 * ✓ and ✗ are the whole gesture; everything else is disclosure. ✗ opens
 * the quick-picks, and they are split at the point that matters: claims
 * about the WORLD go to /api/tasting/evidence, claims about FIT go to
 * /api/tasting/taste. The two lists never merge into one array — a
 * reader of this file should be able to see the doctrine, not infer it.
 *
 * Free text is first-class, not an afterthought: the note box is always
 * available once a verdict is open, on its own, without a quick-pick.
 */

const TASTE_PICKS = [
  { signal: "wouldnt_recommend", label: "Wouldn't recommend" },
  { signal: "not_for_me", label: "Not for me" },
] as const;

type Sent = { kind: "ok"; text: string } | { kind: "error"; text: string };

export function VerdictControls({
  traceId,
  slotId,
  disabled,
}: {
  traceId: string;
  slotId: string;
  /** No trace to attach to — the controls say so rather than failing late. */
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [claim, setClaim] = useState<EvidenceClaim | null>(null);
  const [closedToday, setClosedToday] = useState(false);
  const [openTime, setOpenTime] = useState("");
  const [closeTime, setCloseTime] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);

  const post = async (path: string, body: unknown): Promise<unknown> => {
    setBusy(true);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const parsed = await response.json();
      if (!response.ok) throw new Error(parsed?.error ?? `HTTP ${response.status}`);
      return parsed;
    } finally {
      setBusy(false);
    }
  };

  const sendTaste = async (signal: string) => {
    try {
      await post("/api/tasting/taste", {
        traceId,
        slotId,
        signal,
        ...(note.trim() === "" ? {} : { freeText: note.trim() }),
      });
      setSent({ kind: "ok", text: "Recorded as taste — no fact touched." });
      setOpen(false);
      setNote("");
    } catch (err) {
      setSent({ kind: "error", text: (err as Error).message });
    }
  };

  const sendEvidence = async (picked: EvidenceClaim) => {
    const correction =
      picked === "hours_wrong" && closedToday
        ? { kind: "hours" as const, closedToday: true as const }
        : picked === "hours_wrong" && openTime !== "" && closeTime !== ""
          ? {
              kind: "hours" as const,
              closedToday: false as const,
              open: openTime,
              close: closeTime,
            }
          : undefined;
    try {
      const result = (await post("/api/tasting/evidence", {
        traceId,
        slotId,
        claim: picked,
        ...(note.trim() === "" ? {} : { freeText: note.trim() }),
        ...(correction === undefined ? {} : { correction }),
      })) as EvidenceResultView;
      setSent({
        kind: "ok",
        text:
          result.note !== undefined
            ? `Recorded (${result.authority}) — ${result.note}.`
            : result.flippedFactKey !== null
              ? `Recorded (${result.authority}) — flipped ${result.flippedFactKey}. Regenerate to see it govern.`
              : `Recorded (${result.authority}) — claim stored, no correction supplied, so nothing flipped.`,
      });
      setOpen(false);
      setClaim(null);
      setNote("");
    } catch (err) {
      setSent({ kind: "error", text: (err as Error).message });
    }
  };

  if (disabled === true) {
    return (
      <p className="px-4 pb-3 text-[11px] text-zinc-400 dark:text-zinc-500">
        Verdicts need a generated day.
      </p>
    );
  }

  return (
    <div className="border-t border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void sendTaste("liked")}
          className="rounded-full border border-emerald-300 px-3 py-1 text-sm text-emerald-700 disabled:opacity-40 dark:border-emerald-800 dark:text-emerald-400"
        >
          ✓ Good pick
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setOpen((v) => !v);
            setSent(null);
          }}
          className="rounded-full border border-rose-300 px-3 py-1 text-sm text-rose-700 disabled:opacity-40 dark:border-rose-800 dark:text-rose-400"
        >
          ✗ Something&apos;s off
        </button>
        {sent && (
          <span
            className={`text-[11px] ${
              sent.kind === "ok"
                ? "text-zinc-500 dark:text-zinc-400"
                : "text-rose-600 dark:text-rose-400"
            }`}
          >
            {sent.text}
          </span>
        )}
      </div>

      {open && (
        <div className="mt-2.5 space-y-2.5">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-400 dark:text-zinc-500">
              Wrong about the world
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {EVIDENCE_CLAIMS.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={busy}
                  onClick={() => setClaim(claim === c ? null : c)}
                  className={`rounded-full border px-2.5 py-1 text-xs disabled:opacity-40 ${
                    claim === c
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {CLAIM_LABELS[c]}
                </button>
              ))}
            </div>
          </div>

          {claim === "hours_wrong" && (
            <div className="rounded-xl bg-zinc-50 p-2.5 dark:bg-zinc-800/50">
              <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={closedToday}
                  onChange={(e) => setClosedToday(e.target.checked)}
                />
                Closed on this weekday
              </label>
              {!closedToday && (
                <div className="mt-2 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                  <input
                    type="time"
                    value={openTime}
                    onChange={(e) => setOpenTime(e.target.value)}
                    className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <span>to</span>
                  <input
                    type="time"
                    value={closeTime}
                    onChange={(e) => setCloseTime(e.target.value)}
                    className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </div>
              )}
              <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                Leave both blank to file the complaint without a correction —
                it is recorded, and nothing flips.
              </p>
            </div>
          )}

          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-400 dark:text-zinc-500">
              Wrong for me
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {TASTE_PICKS.map((t) => (
                <button
                  key={t.signal}
                  type="button"
                  disabled={busy}
                  onClick={() => void sendTaste(t.signal)}
                  className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Fine but never before 6pm…"
            className="w-full rounded-xl border border-zinc-200 bg-white p-2.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          />
          <button
            type="button"
            disabled={busy || (claim === null && note.trim() === "")}
            onClick={() => {
              if (claim !== null) return void sendEvidence(claim);
              // A note with no quick-pick is a taste observation, not a
              // claim about the world — it must not become evidence.
              return void sendTaste("not_for_me");
            }}
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {claim === null ? "Send note" : `Send ${CLAIM_LABELS[claim]}`}
          </button>
        </div>
      )}
    </div>
  );
}
