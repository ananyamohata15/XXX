import type { Metadata } from "next";
import { TastingRoom } from "@/components/tasting/TastingRoom";

/**
 * The founder's tasting room (XXX-32). Ships to production and is inert
 * without the secret: this page is a static shell carrying no data, and
 * every route behind it refuses before touching the database.
 *
 * noindex because a gated URL in a search result is noise, not a leak —
 * the gate is the protection, this is hygiene.
 */
export const metadata: Metadata = {
  title: "Tasting room",
  robots: { index: false, follow: false },
};

export default function TastingPage() {
  return <TastingRoom />;
}
