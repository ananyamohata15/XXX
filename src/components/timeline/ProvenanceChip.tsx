import type { ReactNode } from "react";
import { TIER_LABELS, type Tier } from "@/shared/vocabulary";

/**
 * Tier is encoded as a colored dot — emerald Verified, amber Observed,
 * violet Judgment. The board footer carries the legend.
 */
const TIER_DOT: Record<Tier, string> = {
  1: "bg-emerald-500",
  2: "bg-amber-500",
  3: "bg-violet-500",
};

export function ProvenanceChip({
  tier,
  absent = false,
  children,
}: {
  tier: Tier;
  /** Honest absence: we looked, it is not published. Dashed and muted. */
  absent?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
        absent
          ? "border border-dashed border-zinc-300 text-zinc-400 dark:border-zinc-600 dark:text-zinc-500"
          : "border border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
      }`}
      title={TIER_LABELS[tier]}
    >
      <span
        className={`size-1.5 shrink-0 rounded-full ${TIER_DOT[tier]}`}
        aria-hidden
      />
      {children}
      <span className="sr-only">({TIER_LABELS[tier]})</span>
    </span>
  );
}
