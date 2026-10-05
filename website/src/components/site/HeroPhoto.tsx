import Image from "next/image";
import { Lattice } from "@/components/art/Lattice";
import { Logo } from "@/components/art/Logo";
import { heroPhoto } from "@/data/photos";

/**
 * The home page photo, mounted on a thin board-white mat like a print. The box
 * is 4:3 and reserves its size before the image loads, so nothing below moves.
 * It never grows past 680 CSS px wide: the owner's current photo is 680px, and
 * wider would look soft.
 *
 * Until public/images/hero.jpg exists (see src/data/photos.ts), the same box is
 * a calm deep green panel with the logo's CF and the faint window lattice from
 * the footer, so the page looks finished rather than broken.
 */
export function HeroPhoto({ alt, className = "" }: { alt: string; className?: string }) {
  return (
    <div className={`w-full rounded-xl border border-rule bg-board p-2 md:max-w-[680px] lg:p-2.5 ${className}`}>
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-primary">
        {heroPhoto ? (
          <Image
            src={heroPhoto}
            alt={alt}
            fill
            preload
            // Phones: the frame less gutters and mat. 768 to 1023px: capped at 680px
            // less the mat. Wide: the right 7/12 of the 1136px frame less gap and mat.
            sizes="(min-width: 1200px) 610px, (min-width: 1024px) 51vw, (min-width: 768px) 664px, calc(100vw - 48px)"
            // The storefront sign is on the right: keep it in frame if the box crops.
            className="object-cover object-[75%_50%]"
            data-hero-photo
          />
        ) : (
          <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center" data-hero-placeholder>
            <Lattice cell={48} stroke="#fff" opacity={0.045} className="absolute inset-0" />
            <Logo variant="compact" size={84} onDark decorative className="relative" />
          </div>
        )}
      </div>
    </div>
  );
}
