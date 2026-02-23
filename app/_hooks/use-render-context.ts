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
});

export default function useRenderContext() {
  return useContext(RenderContext);
}
