import type { Metadata } from "next";
import { Geist_Mono, Jost } from "next/font/google";
import { DevTools } from "@/components/dev/DevTools";
import "./globals.css";

/**
 * One typeface (XXX-43, Session 15 — founder direction: "build without the
 * italics font"). Jost carries every weight of hierarchy itself; the mono is
 * kept only for the Workshop, where engine words legitimately belong.
 *
 * `next/font` self-hosts at build time — no CDN request, no layout shift, and
 * nothing for a content-security policy to refuse.
 */
const jost = Jost({
  variable: "--font-jost",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Project XXX — Toronto",
  description: "AI travel concierge — timeline prototype",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jost.variable} ${geistMono.variable}`}>
      <body className="bg-paper text-ink min-h-dvh font-sans text-[16.5px] font-[350] antialiased">
        {children}
        {process.env.NODE_ENV === "development" && <DevTools />}
      </body>
    </html>
  );
}
