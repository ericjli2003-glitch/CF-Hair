import { prisma } from "@/lib/db";
import { handle, json } from "@/lib/api";
import { clean } from "@/lib/salon";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const rows = await prisma.staff.findMany({
    where: { active: true },
    include: { services: true },
    orderBy: { sortOrder: "asc" },
  });
  return json(
    rows.map((s) => ({ id: s.id, name: s.name, role: s.role, bio: clean(s.bio), serviceIds: s.services.map((x) => x.serviceId) })),
  );
});
