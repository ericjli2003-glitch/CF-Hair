import { prisma } from "@/lib/db";
import { handle } from "@/lib/api";
import { requireAdminOrAgent } from "@/lib/auth";
import { customersToCsv, listCustomers } from "@/lib/customers";
import { SALON_TZ } from "@/lib/salon";
import { dateKeyOf } from "@/lib/time";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  await requireAdminOrAgent(req);
  const [rows, staff] = await Promise.all([listCustomers(), prisma.staff.findMany()]);
  const csv = customersToCsv(rows, new Map(staff.map((s) => [s.id, s.name])));
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cf-hair-customers-${dateKeyOf(new Date(), SALON_TZ)}.csv"`,
    },
  });
});
