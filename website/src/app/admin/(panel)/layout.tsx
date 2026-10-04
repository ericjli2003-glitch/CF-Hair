import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin/AdminNav";
import { isAdminSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdminSession())) redirect("/admin/login");
  const [newMessages, cardsWaiting] = await Promise.all([
    prisma.message.count({ where: { status: "new" } }),
    prisma.card.count({ where: { status: "pending" } }),
  ]);
  return (
    <>
      <AdminNav newMessages={newMessages} cardsWaiting={cardsWaiting} />
      <main className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">{children}</main>
    </>
  );
}
