import type { Metadata } from "next";

export const metadata: Metadata = { title: "Owner", robots: { index: false, follow: false } };

export default function AdminRoot({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#f7f3ee] text-ink">{children}</div>;
}
