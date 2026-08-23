"use client";

/**
 * The concierge's primitives (XXX-43, Session 15).
 *
 * Written against Radix/Vaul behaviour rather than dropped in from a
 * component library's default styling, and that is a deliberate call worth
 * recording: the founder asked for "modern, minimalist, chic luxury", and a
 * library's stock look is the opposite of a visual identity. So the
 * ACCESSIBILITY comes from the libraries — focus management, dismissal,
 * dialog semantics, drag physics — and the LOOK is ours.
 *
 * Everything here takes its colour from the token set in `globals.css`, never
 * from a literal, so both themes resolve as a set.
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ReactNode } from "react";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/* ── Label ──────────────────────────────────────────────────────────────── */

export function Label({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("label-xs text-muted block", className)}>{children}</span>
  );
}

/* ── Chip ───────────────────────────────────────────────────────────────── */

export interface ChipProps {
  children: ReactNode;
  /** Selected state. Chips are the app's only "on/off" control. */
  on?: boolean;
  /** Renders a dismiss affordance and makes the whole chip remove-on-tap. */
  onRemove?: () => void;
  onClick?: () => void;
  disabled?: boolean;
  /** A count or ordinal shown at reduced weight — pool depth, or rank. */
  note?: string | number;
  className?: string;
}

export function Chip({
  children,
  on = false,
  onRemove,
  onClick,
  disabled,
  note,
  className,
}: ChipProps) {
  const interactive = onClick !== undefined || onRemove !== undefined;
  const handle = onRemove ?? onClick;
  return (
    <button
      type="button"
      aria-pressed={onClick !== undefined ? on : undefined}
      disabled={disabled}
      onClick={handle}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.82rem] font-[350] whitespace-nowrap transition-colors",
        "focus-visible:ring-accent focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        // The offset ring needs a ground to sit against in both themes.
        "focus-visible:ring-offset-paper",
        on
          ? "border-accent bg-accent-soft text-accent"
          : "border-hair-2 text-ink-2",
        disabled && "opacity-40",
        interactive && !disabled && "cursor-pointer",
        className,
      )}
    >
      <span>{children}</span>
      {note !== undefined && (
        <span className="text-[0.72rem] tabular-nums opacity-55">{note}</span>
      )}
      {onRemove !== undefined && (
        <span aria-hidden className="opacity-50">
          ×
        </span>
      )}
    </button>
  );
}

/* ── Button ─────────────────────────────────────────────────────────────── */

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost";
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "label-xs w-full rounded-full py-3.5 text-center transition-opacity",
        "focus-visible:ring-accent focus-visible:ring-offset-paper focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        variant === "primary"
          ? "bg-ink text-paper"
          : "border-hair-2 text-muted border",
        disabled ? "opacity-35" : "cursor-pointer",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ── Field ──────────────────────────────────────────────────────────────── */

/**
 * The chat box. A bottom hairline rather than a bordered box — the founder's
 * surface used to be a grid of outlined controls, and removing the outlines
 * is most of what makes this read as a place to write rather than a form.
 */
export function Field({
  value,
  onChange,
  onSubmit,
  placeholder,
  rows = 3,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        // Enter sends; shift+enter is a newline. A day request is a sentence,
        // not an essay.
        if (e.key === "Enter" && !e.shiftKey && onSubmit) {
          e.preventDefault();
          onSubmit();
        }
      }}
      className={cn(
        "border-hair-2 text-ink placeholder:text-muted w-full resize-none border-0 border-b bg-transparent pb-3 text-[1.02rem] leading-relaxed font-light",
        "focus:border-accent focus:outline-none",
        disabled && "opacity-50",
      )}
    />
  );
}

/* ── Surface ────────────────────────────────────────────────────────────── */

/** A raised card. Radius and shadow are the only two decorations allowed. */
export function Surface({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-surface rounded-[22px] p-6 shadow-[0_1px_1px_rgba(18,19,17,0.03),0_18px_40px_-28px_rgba(18,19,17,0.30)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A hairline divider. */
export const Rule = ({ className }: { className?: string }) => (
  <hr className={cn("border-hair border-t", className)} />
);
