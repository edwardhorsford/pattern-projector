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
}

export const RenderContext = createContext<RenderContextType>({
  erosions: 0,
  layers: {},
  magnifying: false,
  onPageRenderStart: () => {},
  onPageRenderSuccess: () => {},
  patternScale: 1,
});

export default function useRenderContext() {
  return useContext(RenderContext);
}
