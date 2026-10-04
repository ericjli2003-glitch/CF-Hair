// Perm rods are colour-coded by size; service categories borrow the idea. These
// colours mark categories only: as small rod markers or as fills behind black
// text, never as text colour (they are too light on white).
export const ROD_COLOURS: Record<string, string> = {
  Haircuts: "#F2A7B8", // pink
  Perm: "#B7A6E0", // lilac
  Colour: "#7FB2E0", // blue
  Styling: "#F2D27A", // yellow
  Treatment: "#A9C7B6", // grey-green
  Extensions: "#F4B98A", // peach
};

export const rodColour = (category: string) => ROD_COLOURS[category] ?? "#D5DBD8";
