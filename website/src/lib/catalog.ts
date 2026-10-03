import { prisma } from "./db";

export interface CatalogService {
  id: string;
  name: string;
  category: string;
  durationMin: number;
  priceCAD: number;
  description: string;
}
export interface CatalogStaff {
  id: string;
  name: string;
  role: string;
  bio: string;
  serviceIds: string[];
}

export async function getCatalog(): Promise<{ services: CatalogService[]; staff: CatalogStaff[]; categories: string[] }> {
  const [services, staff] = await Promise.all([
    prisma.service.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.staff.findMany({ where: { active: true }, include: { services: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const categories = Array.from(new Set(services.map((s) => s.category)));
  return {
    services: services.map(({ id, name, category, durationMin, priceCAD, description }) => ({
      id, name, category, durationMin, priceCAD, description,
    })),
    staff: staff.map((s) => ({ id: s.id, name: s.name, role: s.role, bio: s.bio, serviceIds: s.services.map((x) => x.serviceId) })),
    categories,
  };
}
