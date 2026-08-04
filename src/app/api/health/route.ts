import { checkHealth } from "@/server/health";

// Never prerender: the health report must reflect the moment of the request.
export const dynamic = "force-dynamic";

export async function GET() {
  const report = await checkHealth();
  return Response.json(report, {
    status: report.status === "healthy" ? 200 : 503,
  });
}
