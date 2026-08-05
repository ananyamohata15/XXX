import { InteractiveTimeline } from "@/components/timeline/InteractiveTimeline";
import { torontoDay } from "@/shared/fixtures/toronto-day";

export default function Home() {
  return <InteractiveTimeline day={torontoDay} />;
}
