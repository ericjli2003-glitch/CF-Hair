import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, Barlow_Semi_Condensed } from "next/font/google";
import { HTML_LANG } from "@/lib/i18n/dictionary";
import { getLang } from "@/lib/i18n/server";
import { clean, fullAddress, salon } from "@/lib/salon";
import "./globals.css";

// Barlow in three widths, Latin only. Chinese and Korean fall back to system
// fonts (see globals.css), so no CJK webfont is downloaded.
const barlow = Barlow({ variable: "--font-barlow", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });
const barlowSemi = Barlow_Semi_Condensed({
  variable: "--font-barlow-semi",
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
});
const barlowCond = Barlow_Condensed({
  variable: "--font-barlow-cond",
  subsets: ["latin"],
  weight: ["600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: `${salon.name} | Coquitlam`, template: `%s | ${salon.name}` },
  description: `${clean(salon.tagline)}. ${fullAddress()}. Book online any time.`,
};

export const viewport: Viewport = { themeColor: "#E8EDEA", viewportFit: "cover" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const lang = await getLang();
  const fonts = [barlow, barlowSemi, barlowCond].map((f) => f.variable).join(" ");
  return (
    <html lang={HTML_LANG[lang]} className={`${fonts} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
