import { Layers } from "@/_lib/layers";
import { LoadStatusEnum } from "@/_lib/load-status-enum";
import { MenuStates, getDefaultMenuStates } from "@/_lib/menu-states";
import {
  CSSProperties,
  Dispatch,
  SetStateAction,
  useMemo,
  useEffect,
  useRef,
  useState,
} from "react";

export default function SvgViewer({
  dataUrl,
  svgStyle,
  setFileLoadStatus,
  setLayoutWidth,
  setLayoutHeight,
  setPageCount,
  layers,
  setLayers,
  patternScale,
  setMenuStates,
  patternScaleFactor,
}: {
  dataUrl: string;
  svgStyle: CSSProperties;
  setFileLoadStatus: Dispatch<SetStateAction<LoadStatusEnum>>;
  setLayoutWidth: Dispatch<SetStateAction<number>>;
  setLayoutHeight: Dispatch<SetStateAction<number>>;
  setPageCount: Dispatch<SetStateAction<number>>;
  layers: Layers;
  setLayers: (layers: Layers) => void;
  patternScale: number;
  setMenuStates: Dispatch<SetStateAction<MenuStates>>;
  patternScaleFactor: number;
}) {
  const objectRef = useRef<HTMLObjectElement>(null);
  const [svgDimensions, setSvgDimensions] = useState({ width: 0, height: 0 });

  const imageStyle = useMemo(
    () => `
    width: 100%;
    height: 100%;
    background-color: white;
  `,
    [],
  );

  function getSvgDimensions(svg: SVGSVGElement): {
    width: number;
    height: number;
  } {
    const width = svg.width.baseVal.value;
    const height = svg.height.baseVal.value;

    if (width > 0 && height > 0) {
      return { width, height };
    }

    const vb = svg.viewBox.baseVal;
    if (vb && vb.width > 0 && vb.height > 0) {
      return { width: vb.width, height: vb.height };
    }

    const fallbackWidth = svg.getBoundingClientRect().width;
    const fallbackHeight = svg.getBoundingClientRect().height;

    return {
      width: fallbackWidth > 0 ? fallbackWidth : 1,
      height: fallbackHeight > 0 ? fallbackHeight : 1,
    };
  }

  useEffect(() => {
    const svg = objectRef.current?.contentDocument?.querySelector("svg");
    if (!svg) return;
    svg.setAttribute("style", imageStyle);
  }, [imageStyle]);

  useEffect(() => {
    const svg = objectRef.current?.contentDocument?.querySelector("svg");
    if (!svg) return;
    // apply visibility
    Object.entries(layers).forEach(([id, layer]) => {
      const g = svg.getElementById(id) as SVGElement;
      if (!g) return;
      g.style.display = layer.visible ? "" : "none";
    });
  }, [layers]);

  useEffect(() => {
    const svg = objectRef.current?.contentDocument?.querySelector("svg");
    if (!svg) return;
    const { width, height } = getSvgDimensions(svg);
    if (width === 0 || height === 0) return;
    setSvgDimensions({ width, height });
    setLayoutWidth(width * patternScale);
    setLayoutHeight(height * patternScale);
  }, [objectRef, setLayoutWidth, setLayoutHeight, patternScale]);

  useEffect(() => {
    if (
      !objectRef.current ||
      svgDimensions.width <= 0 ||
      svgDimensions.height <= 0
    ) {
      return;
    }

    // Size the <object> to the scaled dimensions. The SVG inside fills the object
    // via width/height 100% in its inline style (set via imageStyle), and uses its
    // viewBox to scale content correctly — avoiding the clipping that occurred when
    // using CSS transform: scale() on the inner SVG element.
    objectRef.current.style.width = `${svgDimensions.width * patternScaleFactor}px`;
    objectRef.current.style.height = `${svgDimensions.height * patternScaleFactor}px`;
  }, [svgDimensions, patternScaleFactor]);

  return (
    <object
      ref={objectRef}
      className="pointer-events-none"
      data={dataUrl}
      type="image/svg+xml"
      style={svgStyle}
      onLoad={(e) => {
        const object = e.target as HTMLObjectElement;
        const svg = object.contentDocument?.querySelector("svg");
        svg?.setAttribute("style", imageStyle);

        if (!svg) {
          setFileLoadStatus(LoadStatusEnum.FAILED);
          return;
        }
        setFileLoadStatus(LoadStatusEnum.SUCCESS);
        const { width, height } = getSvgDimensions(svg);
        setSvgDimensions({ width, height });
        setLayoutWidth(width * patternScale);
        setLayoutHeight(height * patternScale);
        setPageCount(1);
        // get all groups at the root if the svg
        const groupLayers: Layers = {};
        Array.from(svg.querySelectorAll(`g`))
          .filter((g) => g.getAttribute("inkscape:groupmode") == "layer")
          .forEach((g) => {
            const layerName = g.getAttribute("inkscape:label") ?? g.id;
            const isVisible = getComputedStyle(g).display !== "none";
            groupLayers[g.id] = {
              name: layerName,
              ids: [g.id],
              visible: isVisible,
            };
          });
        setLayers(groupLayers);
        if (Object.keys(groupLayers).length > 1) {
          setMenuStates((prev) => ({
            ...getDefaultMenuStates(),
            layers: true,
            menuPosition: prev.menuPosition,
          }));
        } else {
          setLayers({});
          setMenuStates((prev) => ({
            ...getDefaultMenuStates(),
            menuPosition: prev.menuPosition,
          }));
        }
      }}
    ></object>
  );
}
