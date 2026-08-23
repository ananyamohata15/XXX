import type { Metadata } from "next";
import { Concierge } from "@/components/concierge/Concierge";

export const metadata: Metadata = {
  title: "Toronto",
  robots: { index: false, follow: false },
};

export default function TastingPage() {
  return <Concierge />;
}
