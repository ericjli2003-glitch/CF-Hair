// Perm rods are colour-coded by size; service categories borrow the idea. The
// colours live as tokens in globals.css (--color-cat-*). They mark categories
// only: as small rod markers or as fills behind dark text (white text on the
// deep green Extensions fill), never as text colour. The category name is
// always written next to the colour.
const CATEGORY_TOKENS: Record<string, string> = {
  Haircuts: "haircuts", // terracotta
  Perm: "perm", // lilac
  Colour: "colour", // green tint
  Styling: "styling", // light terracotta
  Treatment: "treatment", // light lilac
  Extensions: "extensions", // deep green, white text
};

/** Categories whose fill is dark, so text on the fill is white. */
const DARK_FILLS = new Set(["Extensions"]);

const token = (category: string) => CATEGORY_TOKENS[category] ?? "other";

/** The category fill, as a CSS colour. */
export const rodColour = (category: string) => `var(--color-cat-${token(category)})`;

/** A lighter tint of the category: hover, selected rows and schedule blocks. */
export const rodTint = (category: string) => `var(--color-cat-${token(category)}-tint)`;

/** The text colour that reads on the category fill. */
export const rodText = (category: string) => (DARK_FILLS.has(category) ? "white" : "var(--color-ink)");
