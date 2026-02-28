import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";

import {
  Dispatch,
  SetStateAction,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import CustomRenderer from "@/_components/pdf-custom-renderer";
import { getPageNumbers, getRowsColumns } from "@/_lib/get-page-numbers";
import { PDF_TO_CSS_UNITS } from "@/_lib/pixels-per-inch";
import { RenderContext } from "@/_hooks/use-render-context";
import { useTransformerContext } from "@/_hooks/use-transform-context";
import {
  LineDirection,
  StitchSettings,
} from "@/_lib/interfaces/stitch-settings";
import { StitchSettingsAction } from "@/_reducers/stitchSettingsReducer";
import { getLayersFromPdf, Layers } from "@/_lib/layers";
import { LoadStatusEnum } from "@/_lib/load-status-enum";
import { Point } from "@/_lib/point";
import { useTranslations } from "next-intl";
import { MenuStates, getDefaultMenuStates } from "@/_lib/menu-states";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.js",
  import.meta.url,
).toString();

function PdfViewer({
  file,
  layers,
  setLayers,
  setPageCount,
  setLayoutWidth,
  setLayoutHeight,
  dispatchStitchSettings,
  pageCount,
  lineThickness,
  stitchSettings,
  filter,
  canvasBackground,
  recolourHex,
  magnifying,
  setFileLoadStatus,
  setLineThicknessStatus,
  gridCenter,
  patternScale,
  setMenuStates,
  renderVersion,
}: {
  file: any;
  layers: Layers;
  setLayers: (layers: Layers) => void;
  setPageCount: Dispatch<SetStateAction<number>>;
  setLayoutWidth: Dispatch<SetStateAction<number>>;
  setLayoutHeight: Dispatch<SetStateAction<number>>;
  dispatchStitchSettings: Dispatch<StitchSettingsAction>;
  pageCount: number;
  lineThickness: number;
  stitchSettings: StitchSettings;
  filter: string;
  canvasBackground?: string;
  recolourHex?: string;
  magnifying: boolean;
  setFileLoadStatus: Dispatch<SetStateAction<LoadStatusEnum>>;
  setLineThicknessStatus: Dispatch<SetStateAction<LoadStatusEnum>>;
  gridCenter: Point;
  patternScale: number;
  setMenuStates: Dispatch<SetStateAction<MenuStates>>;
  renderVersion: number;
}) {
  const [pageSizes, setPageSize] = useReducer(
    pageSizeReducer,
    new Map<number, { width: number; height: number }>(),
  );
  const transformer = useTransformerContext();
  const t = useTranslations("PdfViewer");
  const hasRecenteredRef = useRef(false);

  function onDocumentLoadSuccess(docProxy: PDFDocumentProxy) {
    const numPages = docProxy.numPages;
    setPageCount(numPages);
    setPageSize({ action: "clear" });
    hasRecenteredRef.current = false;
    if (stitchSettings.pageRange.endsWith("-") && numPages > 0) {
      dispatchStitchSettings({
        type: "set-page-range",
        pageRange: stitchSettings.pageRange + numPages,
      });
    }
    getLayersFromPdf(docProxy).then((l) => {
      if (numPages === 1) {
        if (Object.entries(l).length > 1) {
          setMenuStates((prev) => ({
            ...getDefaultMenuStates(),
            layers: true,
            menuPosition: prev.menuPosition,
          }));
        } else {
          setMenuStates((prev) => ({
            ...getDefaultMenuStates(),
            menuPosition: prev.menuPosition,
          }));
        }
      } else {
        // For multi-page PDFs, don't auto-open stitch menu - just reset to defaults
        setMenuStates((prev) => ({
          ...getDefaultMenuStates(),
          menuPosition: prev.menuPosition,
        }));
      }
      setLayers(l);
    });
  }

  function onPageLoadSuccess(pdfProxy: PDFPageProxy) {
    const scale = (pdfProxy.userUnit || 1) * PDF_TO_CSS_UNITS;
    const width = pdfProxy.view[2] * scale;
    const height = pdfProxy.view[3] * scale;
    setPageSize({
      action: "setPage",
      pageNumber: pdfProxy.pageNumber,
      width,
      height,
    });
    if (pageCount === 1 && !hasRecenteredRef.current) {
      hasRecenteredRef.current = true;
      transformer.recenter(gridCenter, width, height);
    }
  }

  // Debounce refs to prevent multiple pages triggering many state updates
  const renderStartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const renderSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const onPageRenderStart = useCallback(() => {
    // Debounce: only set loading if not already pending
    if (renderStartTimeoutRef.current) return;
    renderStartTimeoutRef.current = setTimeout(() => {
      setLineThicknessStatus(LoadStatusEnum.LOADING);
      renderStartTimeoutRef.current = null;
    }, 0);
  }, [setLineThicknessStatus]);

  const onPageRenderSuccess = useCallback(() => {
    // Clear any pending start timeout
    if (renderStartTimeoutRef.current) {
      clearTimeout(renderStartTimeoutRef.current);
      renderStartTimeoutRef.current = null;
    }
    // Debounce success: wait for all pages to finish
    if (renderSuccessTimeoutRef.current) {
      clearTimeout(renderSuccessTimeoutRef.current);
    }
    renderSuccessTimeoutRef.current = setTimeout(() => {
      setFileLoadStatus(LoadStatusEnum.SUCCESS);
      setLineThicknessStatus(LoadStatusEnum.SUCCESS);
      renderSuccessTimeoutRef.current = null;
    }, 50); // Small delay to batch multiple page completions
  }, [setFileLoadStatus, setLineThicknessStatus]);

  const renderContextValue = useMemo(
    () => ({
      erosions: lineThickness,
      layers,
      magnifying,
      onPageRenderStart,
      onPageRenderSuccess,
      patternScale,
      recolourHex,
      renderVersion,
      // themeFilter is baked into each canvas draw call by CustomRenderer,
      // so the container div never needs a CSS filter. On Safari the worker
      // pixel path handles Dark theme inversion via recolour-to-white.
      themeFilter: filter,
    }),
    [
      lineThickness,
      layers,
      magnifying,
      onPageRenderStart,
      onPageRenderSuccess,
      patternScale,
      recolourHex,
      renderVersion,
      filter,
    ],
  );

  const customTextRenderer = useCallback(({ str }: { str: string }) => {
    return `<span class="opacity-0 hover:opacity-100" style="background-color: #FFF; color: #000; padding: 2px 4px; border-radius: 2px; transform-origin: center; display: inline-block;" onmouseover="this.style.transform='scale(2)'" onmouseout="this.style.transform='scale(1)'">${str}</span>`;
  }, []);

  useEffect(() => {
    const pages = getPageNumbers(stitchSettings.pageRange, pageCount);
    const [rows, columns] = getRowsColumns(
      pages,
      stitchSettings.lineCount,
      stitchSettings.lineDirection,
    );
    const [tileWidth, tileHeight] = getTileSize(pages, pageSizes, patternScale);
    const w =
      tileWidth * columns -
      (columns - 1) * PDF_TO_CSS_UNITS * stitchSettings.edgeInsets.horizontal;
    const h =
      tileHeight * rows -
      (rows - 1) * PDF_TO_CSS_UNITS * stitchSettings.edgeInsets.vertical;
    setLayoutWidth(w);
    setLayoutHeight(h);
  }, [
    pageSizes,
    stitchSettings,
    setLayoutWidth,
    setLayoutHeight,
    pageCount,
    patternScale,
  ]);

  const pages = getPageNumbers(stitchSettings.pageRange, pageCount);
  const [rows, columns] = getRowsColumns(
    pages,
    stitchSettings.lineCount,
    stitchSettings.lineDirection,
  );
  const keys = getKeys(pages);
  const [tileWidth, tileHeight] = getTileSize(pages, pageSizes, patternScale);
  const cssEdgeInsets = {
    vertical:
      stitchSettings.edgeInsets.vertical * PDF_TO_CSS_UNITS * patternScale,
    horizontal:
      stitchSettings.edgeInsets.horizontal * PDF_TO_CSS_UNITS * patternScale,
  };
  const insetWidth = `${tileWidth - cssEdgeInsets.horizontal}px`;
  const insetHeight = `${tileHeight - cssEdgeInsets.vertical}px`;

  return (
    <Document
      file={file}
      onLoadSuccess={onDocumentLoadSuccess}
      noData={null}
      error={null}
      onLoadError={() => setFileLoadStatus(LoadStatusEnum.FAILED)}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, max-content)`,
          gridTemplateRows: `repeat(${rows}, max-content)`,
          gridAutoFlow:
            stitchSettings.lineDirection == LineDirection.Row
              ? "column"
              : "row",
          marginRight: cssEdgeInsets.horizontal,
          marginBottom: cssEdgeInsets.vertical,
          // The theme filter is baked into each canvas draw call by
          // CustomRenderer (Chrome: appended to cssFilter; Safari: Dark theme
          // handled as pixel-level inversion in the worker). The container
          // never needs a CSS filter — this prevents the split-ownership
          // flash that occurred when the container filter committed
          // synchronously while canvas pixels were still from the old theme.
          filter: "none",
          // Keep page blending and stacking scoped to this container.
          isolation: "isolate",
          position: "relative",
        }}
      >
        {pages.map((value, index) => {
          return (
            <div
              key={keys[index]}
              style={{
                width: insetWidth,
                height: insetHeight,
                mixBlendMode:
                  cssEdgeInsets.horizontal == 0 && cssEdgeInsets.vertical == 0
                    ? "normal"
                    : "darken",
              }}
            >
              {value != 0 && (
                <RenderContext.Provider
                  value={renderContextValue}
                >
                  <Page
                    // Pass a fixed scale so react-pdf's internal page context
                    // doesn't change when patternScale changes. Our CustomRenderer
                    // reads patternScale from RenderContext and computes its own
                    // viewport independently. Changing this prop causes react-pdf
                    // to remount the custom renderer, resetting all refs/canvas.
                    scale={PDF_TO_CSS_UNITS}
                    pageNumber={value}
                    renderMode="custom"
                    customRenderer={CustomRenderer}
                    customTextRenderer={customTextRenderer}
                    canvasBackground={canvasBackground}
                    // We render our own canvas output; disabling extra react-pdf layers
                    // avoids additional absolute/z-indexed sublayers.
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    onLoadSuccess={onPageLoadSuccess}
                  />
                </RenderContext.Provider>
              )}
            </div>
          );
        })}
      </div>
    </Document>
  );
}

export default memo(PdfViewer);

function getKeys(pages: number[]): string[] {
  const keys: string[] = [];
  const values = new Map<number, number>();
  for (const value of pages) {
    const seen = values.get(value) ?? 0;
    keys.push(`${value}_${seen}`);
    values.set(value, seen + 1);
  }
  return keys;
}

function pageSizeReducer(
  state: Map<number, { width: number; height: number }>,
  action:
    | { action: "clear" }
    | { action: "setPage"; pageNumber: number; width: number; height: number },
) {
  if (action.action === "clear") {
    return new Map();
  }
  const { pageNumber, width, height } = action;
  const newState = new Map(state);
  newState.set(pageNumber, { width, height });
  return newState;
}

function getTileSize(
  pages: number[],
  pageSizes: Map<number, { width: number; height: number }>,
  patternScale: number,
): [number, number] {
  let tileWidth = 0;
  let tileHeight = 0;
  for (const page of pages) {
    tileWidth = Math.max(tileWidth, pageSizes.get(page)?.width ?? 0);
    tileHeight = Math.max(tileHeight, pageSizes.get(page)?.height ?? 0);
  }
  return [tileWidth * patternScale, tileHeight * patternScale];
}
