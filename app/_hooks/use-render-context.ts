import { useContext } from "react";
import { createContext } from "react";
import { Layers } from "@/_lib/layers";

export interface RenderContextType {
  erosions: number;
  layers: Layers;
  magnifying: boolean;
  onPageRenderStart: () => void;
  onPageRenderSuccess: () => void;
  patternScale: number;
  /** Colour lift floor value (0-1). Non-zero only for colour themes (Green/Cyan/Amber/Magenta). */
  colourLift: number;
  /** When set, the recolour SVG filter is used instead of lift-blacks + container invert/sepia/hue-rotate. */
  recolourHex?: string;
  /** Incremented to bust the render cache and force all pages to re-render from scratch. */
  renderVersion: number;
}

export const RenderContext = createContext<RenderContextType>({
  erosions: 0,
  layers: {},
  magnifying: false,
  onPageRenderStart: () => {},
  onPageRenderSuccess: () => {},
  patternScale: 1,
  colourLift: 0,
  recolourHex: undefined,
  renderVersion: 0,
});

export default function useRenderContext() {
  return useContext(RenderContext);
}
