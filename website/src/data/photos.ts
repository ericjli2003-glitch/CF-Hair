// Owner photo slots. Drop an image into website/public/photos/ and set its path
// here (e.g. "stylist-a": "/photos/stylist-a.jpg"). Slots left as null show a
// dashed frame labelled "Photo slot" so it is obvious where real photos go.
export const photos: Record<string, string | null> = {
  "stylist-a": null,
  "stylist-b": null,
  "stylist-c": null,
};

// The home page photo: public/images/hero.jpg, shown 4:3 and at most 680 CSS px
// wide. next.config.ts checks at build time (and when `npm run dev` starts)
// whether the file exists and sets HERO_PHOTO. Until it does, the hero shows a
// deep green panel with the seal in the same box. To force either state,
// replace this line with a path or null.
export const heroPhoto: string | null = process.env.HERO_PHOTO === "1" ? "/images/hero.jpg" : null;
