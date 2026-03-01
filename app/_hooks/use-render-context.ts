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
  /** When set, the recolour SVG filter maps black→target colour via feColorMatrix. */
  recolourHex?: string;
  /** Incremented to bust the render cache and force all pages to re-render from scratch. */
  renderVersion: number;
  /** When false, the high-res viewport overlay canvas is hidden (dev toggle). */
  showHighResOverlay?: boolean;
  /** When true, tints the high-res overlay amber so it’s visually distinct from the base render (dev alignment test). */
  debugTintHighRes?: boolean;  /** When true, limits the base render to a very small pixel budget so the high-res overlay effect is clearly visible. */
  debugLowResBase?: boolean;  /**
   * The CSS filter string representing the active theme transformation
   * (e.g. "invert(1)" for Dark). On non-Safari browsers this is baked
   * directly into the canvas draw call so the container div doesn't need
   * it, avoiding the split-ownership flash between commits and paint.
   */
  themeFilter?: string;
}

export const RenderContext = createContext<RenderContextType>({
  erosions: 0,
  layers: {},
  magnifying: false,
  onPageRenderStart: () => {},
  onPageRenderSuccess: () => {},
  patternScale: 1,
  recolourHex: undefined,
  renderVersion: 0,
  showHighResOverlay: true,
  debugTintHighRes: false,
  debugLowResBase: false,
  themeFilter: undefined,
});

export default function useRenderContext() {
  return useContext(RenderContext);
}
