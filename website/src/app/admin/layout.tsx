import type { Metadata } from "next";

export const metadata: Metadata = { title: "Owner", robots: { index: false, follow: false } };

export default function AdminRoot({ children }: { children: React.ReactNode }) {
  return <div className="admin min-h-screen bg-tile text-ink">{children}</div>;
}
