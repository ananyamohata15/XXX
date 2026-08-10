"use client";

import type { TastingMeter } from "@/shared/tasting";

/**
 * The meter (XXX-32: "the founder sees the meter").
 *
 * Everything that cost money or time on this generation, plus the
 * month-to-date Details gauge ruled at CP1 — which proved its own
 * necessity the day it was ruled, at 515 of 1,000 free events consumed
 * by day 9 of the month.
 *
 * The cap is a runaway guard; THIS is the budget control. A number in
 * code cannot stop sustained spend — a founder watching the bar can.
 */

const pct = (n: number, d: number) => Math.min(100, Math.round((n / d) * 100));

function Gauge({
  label,
  value,
  max,
  detail,
}: {
  label: string;
  value: number;
  max: number;
  detail: string;
}) {
  const filled = pct(value, max);
  const tone =
    filled >= 90
      ? "bg-rose-500"
      : filled >= 60
        ? "bg-amber-500"
        : "bg-emerald-500";
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
        <span className="font-mono tabular-nums text-zinc-600 dark:text-zinc-300">
          {value} / {max}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div className={`h-full ${tone}`} style={{ width: `${filled}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">{detail}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="font-mono tabular-nums text-zinc-700 dark:text-zinc-200">
        {value}
      </span>
    </div>
  );
}

export function Meter({
  meter,
  synthetic,
}: {
  meter: TastingMeter;
  synthetic: boolean;
}) {
  const q = meter.quota;
  const stages = Object.entries(meter.stageMs)
    .filter(([key, ms]) => key !== "totalMs" && ms > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <section className="mt-8 space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
        Meter
      </h2>

      <div className="space-y-3">
        <Gauge
          label="Details events this month"
          value={q.detailsThisMonth}
          max={q.detailsFreeCap}
          detail={`Google's free Enterprise cap. Past it, each event costs $0.020.`}
        />
        <Gauge
          label="Generations today"
          value={q.generationsToday}
          max={q.dailyCap}
          detail={`Runaway guard, not a budget. Resets ${new Date(q.resetsAt).toLocaleString()}.`}
        />
      </div>

      <div className="space-y-1 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        {synthetic ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Synthetic day — nothing was fetched, nothing was spent, and the
            figures below would be zero either way.
          </p>
        ) : (
          <>
            <Row label="Cost (list)" value={`$${meter.estCostUsd.toFixed(3)}`} />
            <Row label="Latency" value={`${(meter.totalMs / 1000).toFixed(1)} s`} />
            <Row label="Details calls" value={String(meter.detailsCalls)} />
            <Row
              label="Searches / links minted"
              value={`${meter.searchTextCalls} / ${meter.linksMinted}`}
            />
            <Row label="Transit calls" value={String(meter.transitCalls)} />
            <Row
              label="Validation passes"
              value={
                meter.repairLog.length === 0
                  ? `${meter.validationPasses} (clean first pass)`
                  : `${meter.validationPasses} · repaired ${meter.repairLog
                      .map((r) => r.ruleIds.join(","))
                      .join(" → ")}`
              }
            />
            <Row
              label="Anthropic"
              value={`${meter.anthropic.calls} calls · ${meter.anthropic.inputTokens}/${meter.anthropic.outputTokens} tok · $${meter.anthropic.estCostUsd.toFixed(4)}`}
            />
            {(meter.anthropic.contractRetries > 0 ||
              meter.anthropic.toneRetries > 0) && (
              <Row
                label="LLM retries"
                value={`contract ${meter.anthropic.contractRetries} · tone ${meter.anthropic.toneRetries}`}
              />
            )}
            <Row
              label="Founder overrides"
              value={
                meter.founderExpired > 0
                  ? `${meter.founderOverrides} governing · ${meter.founderExpired} expired`
                  : String(meter.founderOverrides)
              }
            />
            {stages.length > 0 && (
              <Row
                label="Stages"
                value={stages
                  .map(([k, ms]) => `${k.replace(/Ms$/, "")} ${ms}`)
                  .join(" · ")}
              />
            )}
          </>
        )}
        <Row label="Seed" value={String(meter.seed)} />
        <p className="pt-1 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
          trace {meter.traceId}
        </p>
      </div>
    </section>
  );
}
