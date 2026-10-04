import { Caveat } from "next/font/google";

// Caveat is the handwriting face the notes pipeline uses on its proof sheets, so
// cards here look the way the owner has seen them before. Latin only: Chinese and
// Korean lines are written by hand at the salon and shown in a system font.
const caveat = Caveat({ variable: "--font-caveat", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

export default function CardsLayout({ children }: { children: React.ReactNode }) {
  return <div className={caveat.variable}>{children}</div>;
}
