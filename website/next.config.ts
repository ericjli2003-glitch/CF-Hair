import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

// The home hero photo is optional: when public/images/hero.jpg is there at build
// time, the hero shows it; otherwise a designed placeholder. See src/data/photos.ts.
const heroPhoto = existsSync(join(process.cwd(), "public", "images", "hero.jpg"));

const nextConfig: NextConfig = {
  env: { HERO_PHOTO: heroPhoto ? "1" : "" },
};

export default nextConfig;
