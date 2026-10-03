import { HandwryttenAdapter } from "./handwrytten.js";
import { PlotterAdapter } from "./plotter.js";
import type { ProviderAdapter } from "./types.js";

export function createProvider(name: string, opts: { outDir: string; fetchImpl?: typeof fetch }): ProviderAdapter {
  switch (name) {
    case "handwrytten":
      return new HandwryttenAdapter({ fetchImpl: opts.fetchImpl });
    case "plotter":
      return new PlotterAdapter({ outDir: opts.outDir });
    default:
      throw new Error(`Unknown provider "${name}". Use handwrytten or plotter.`);
  }
}

export type { ProviderAdapter } from "./types.js";
