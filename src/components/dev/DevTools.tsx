"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Dev-only on-device eyes (never rendered in production — the layout gates
 * on NODE_ENV):
 * - Hydration badge: SSR renders the amber "JS not running" state; the
 *   mount effect flips it green. If the badge stays amber on a device,
 *   hydration never ran — which is exactly how the blocked-cross-origin
 *   failure hid behind "gestures don't work".
 * - eruda: a floating console/inspector for phones, loaded only after
 *   hydration (so it can never mask the badge's signal).
 */
const emptySubscribe = () => () => {};

export function DevTools() {
  // false on the server render, true on any client render — the cleanest
  // hydration detector, no state, no cascading-render lint complaint.
  const hydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  useEffect(() => {
    import("eruda").then((eruda) => eruda.default.init());
  }, []);

  return (
    <div
      className={`pointer-events-none fixed right-3 bottom-3 z-50 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        hydrated
          ? "bg-emerald-600/90 text-white"
          : "bg-amber-500/90 text-black"
      }`}
    >
      {hydrated ? "JS live" : "JS not running"}
    </div>
  );
}
