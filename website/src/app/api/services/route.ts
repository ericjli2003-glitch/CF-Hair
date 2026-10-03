import { prisma } from "@/lib/db";
import { handle, json } from "@/lib/api";
import { clean } from "@/lib/salon";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const rows = await prisma.service.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  return json(
    rows.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      durationMin: s.durationMin,
      priceCAD: s.priceCAD,
      description: clean(s.description),
    })),
  );
});
