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
  /**
   * null = never fetched. There is no tier because there is no fact:
   * the chip loses its dot rather than borrowing a colour it has not
   * earned.
   */
  tier: Tier | null;
  /** Honest absence: we looked, it is not published. Dashed and muted. */
  absent?: boolean;
  children: ReactNode;
}) {
  const label = tier === null ? "Not recorded" : TIER_LABELS[tier];
  const muted = absent || tier === null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
        muted
          ? "border border-dashed border-zinc-300 text-zinc-400 dark:border-zinc-600 dark:text-zinc-500"
          : "border border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
      }`}
      title={label}
    >
      <span
        className={`size-1.5 shrink-0 rounded-full ${
          tier === null
            ? "border border-zinc-300 dark:border-zinc-600"
            : TIER_DOT[tier]
        }`}
        aria-hidden
      />
      {children}
      <span className="sr-only">({label})</span>
    </span>
  );
}
