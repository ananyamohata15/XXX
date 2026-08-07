import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Dev-only: the phone-review loop loads the dev server via the LAN IP,
   * which Next 16 treats as a cross-origin request and blocks /_next/*
   * assets for — HTML renders, hydration never runs. The wildcard covers
   * whatever address the router hands this machine next. No production
   * impact: Vercel serves same-origin.
   */
  allowedDevOrigins: ["192.168.2.10", "192.168.2.*"],
};

export default nextConfig;
