import type { Metadata, Viewport } from "next";
import {
  Cormorant_Garamond,
  Jost,
  Noto_Sans_HK,
  Noto_Sans_KR,
  Noto_Sans_SC,
  Noto_Serif_HK,
  Noto_Serif_KR,
  Noto_Serif_SC,
} from "next/font/google";
import { HTML_LANG } from "@/lib/i18n/dictionary";
import { getLang } from "@/lib/i18n/server";
import { clean, fullAddress, salon } from "@/lib/salon";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});
const jost = Jost({ variable: "--font-jost", subsets: ["latin"], display: "swap" });
const serifSC = Noto_Serif_SC({ variable: "--font-serif-sc", weight: ["500", "600"], preload: false, display: "swap" });
const sansSC = Noto_Sans_SC({ variable: "--font-sans-sc", weight: ["400", "500"], preload: false, display: "swap" });
// Hong Kong glyph forms for the Traditional Chinese (Cantonese) version.
const serifHK = Noto_Serif_HK({ variable: "--font-serif-hk", weight: ["500", "600"], preload: false, display: "swap" });
const sansHK = Noto_Sans_HK({ variable: "--font-sans-hk", weight: ["400", "500"], preload: false, display: "swap" });
const serifKR = Noto_Serif_KR({ variable: "--font-serif-kr", weight: ["500", "600"], preload: false, display: "swap" });
const sansKR = Noto_Sans_KR({ variable: "--font-sans-kr", weight: ["400", "500"], preload: false, display: "swap" });

export const metadata: Metadata = {
  title: { default: `${salon.name} | Coquitlam`, template: `%s | ${salon.name}` },
  description: `${clean(salon.tagline)}. ${fullAddress()}. Book online any time.`,
};

export const viewport: Viewport = { themeColor: "#f4eee6" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const lang = await getLang();
  const fonts = [cormorant, jost, serifSC, sansSC, serifHK, sansHK, serifKR, sansKR].map((f) => f.variable).join(" ");
  return (
    <html lang={HTML_LANG[lang]} className={`${fonts} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
