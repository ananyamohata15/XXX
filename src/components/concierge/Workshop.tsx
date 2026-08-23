"use client";

/**
 * The Workshop (XXX-43, Session 15) — Screen 7.
 *
 * Everything the engineer needs, off the product surface. The founder's
 * verdict was that the room had become an instrument panel: two dropdowns,
 * one of them listing raw day slugs, a seed field, a synthetic-data toggle
 * defaulting to ON. None of it is deleted — a session's worth of regression
 * machinery lives there — it moves behind a gear icon.
 *
 * **The persona dropdown lives here and ONLY here.** Personas are for
 * regression, not for planning a Saturday, and having one on the front door
 * was most of why the founder could not answer "does this feel like mine".
 *
 * Vaul for the sheet: a bottom drawer with real drag physics is the right
 * mobile idiom, and getting dismissal and focus-trapping right by hand is
 * how accessibility bugs are written.
 */

import { Drawer } from "vaul";
import { Settings2 } from "lucide-react";
import { Button, Chip, Label, Rule } from "@/components/ui/primitives";
import type { ReactNode } from "react";

export interface WorkshopControls {
  personaKey: string;
  personaKeys: string[];
  onPersonaKey: (key: string) => void;
  themeKey: string;
  themeOptions: { key: string; label: string }[];
  onThemeKey: (key: string) => void;
  date: string;
  onDate: (d: string) => void;
  budget: string;
  onBudget: (b: string) => void;
  lodgingOn: boolean;
  onLodging: (v: boolean) => void;
  synthetic: boolean;
  onSynthetic: (v: boolean) => void;
  /** Raw rule detail — the one place engine words are correct. */
  detail?: ReactNode;
  meter?: ReactNode;
  onGenerate: () => void;
  busy: boolean;
}

export function Workshop(props: WorkshopControls) {
  return (
    <Drawer.Root>
      <Drawer.Trigger asChild>
        <button
          type="button"
          aria-label="Workshop"
          className="text-muted hover:text-ink focus-visible:ring-accent focus-visible:ring-offset-paper rounded-full p-2 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <Settings2 size={18} strokeWidth={1.25} />
        </button>
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Drawer.Content className="bg-surface fixed right-0 bottom-0 left-0 z-50 mt-24 flex h-[88vh] flex-col rounded-t-[22px] outline-none">
          <div className="bg-hair-2 mx-auto mt-3 h-1 w-10 shrink-0 rounded-full" />
          <div className="mx-auto w-full max-w-md flex-1 overflow-y-auto px-6 pt-6 pb-10">
            <Drawer.Title className="display mb-1 text-[1.6rem]">
              Workshop
            </Drawer.Title>
            <Drawer.Description className="text-muted mb-7 text-[0.86rem] font-light">
              Regression controls and instrumentation. Not the product.
            </Drawer.Description>

            <div className="flex flex-col gap-7">
              <Group label="Persona — regression only">
                <div className="flex flex-wrap gap-2">
                  {props.personaKeys.map((k) => (
                    <Chip
                      key={k}
                      on={props.personaKey === k}
                      onClick={() => props.onPersonaKey(k)}
                    >
                      {k}
                    </Chip>
                  ))}
                </div>
              </Group>

              <Group label="Theme">
                <div className="flex flex-wrap gap-2">
                  {props.themeOptions.map((t) => (
                    <Chip
                      key={t.key}
                      on={props.themeKey === t.key}
                      onClick={() => props.onThemeKey(t.key)}
                    >
                      {t.label}
                    </Chip>
                  ))}
                </div>
              </Group>

              <Group label="Date">
                <input
                  type="date"
                  value={props.date}
                  onChange={(e) => props.onDate(e.target.value)}
                  className="border-hair-2 text-ink w-full border-0 border-b bg-transparent pb-2 font-mono text-[0.86rem] focus:outline-none"
                />
              </Group>

              <Group label="Budget cap (CAD)">
                <input
                  type="number"
                  inputMode="numeric"
                  value={props.budget}
                  placeholder="none"
                  onChange={(e) => props.onBudget(e.target.value)}
                  className="border-hair-2 text-ink placeholder:text-muted w-full border-0 border-b bg-transparent pb-2 font-mono text-[0.86rem] focus:outline-none"
                />
              </Group>

              <Group label="Switches">
                <div className="flex flex-wrap gap-2">
                  <Chip
                    on={props.lodgingOn}
                    onClick={() => props.onLodging(!props.lodgingOn)}
                  >
                    Lodging downtown
                  </Chip>
                  <Chip
                    on={props.synthetic}
                    onClick={() => props.onSynthetic(!props.synthetic)}
                  >
                    Test pattern
                  </Chip>
                </div>
                {props.synthetic && (
                  <p className="text-warn mt-3 text-[0.8rem] font-light">
                    Test pattern is on. Days are fabricated and spend nothing —
                    turn it off before judging anything.
                  </p>
                )}
              </Group>

              <Button onClick={props.onGenerate} disabled={props.busy}>
                {props.busy ? "Working" : "Generate here"}
              </Button>

              {props.detail !== undefined && (
                <>
                  <Rule />
                  <Group label="Rule detail">{props.detail}</Group>
                </>
              )}
              {props.meter !== undefined && (
                <>
                  <Rule />
                  <Group label="Meter">{props.meter}</Group>
                </>
              )}
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
