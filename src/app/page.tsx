import { TimelineBoard } from "@/components/timeline/TimelineBoard";
import { torontoDay } from "@/shared/fixtures/toronto-day";

export default function Home() {
  return <TimelineBoard day={torontoDay} />;
}
