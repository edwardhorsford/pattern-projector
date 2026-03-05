"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { pdfjs } from "react-pdf";
import Filters from "@/_components/filters";

type ThemeMode = "light" | "dark" | "green";

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.js",
  import.meta.url,
).toString();

interface FilterConfig {
  name: string;
  filter: string;
  description: string;
}

const FILTER_PRESETS: FilterConfig[] = [
  {
    name: "None (Original)",
    filter: "none",
    description: "No processing - raw PDF rendering",
  },
  {
    name: "Erode 1",
    filter: "url(#erode-1)",
    description: "Current: Single erosion pass",
  },
  {
    name: "Erode 2",
    filter: "url(#erode-2)",
    description: "Current: Double erosion pass",
  },
  {
    name: "Erode 1 + Contrast",
    filter: "url(#erode-1) contrast(2)",
    description: "Current approach with contrast boost",
  },
  {
    name: "Erode 2 + Contrast",
    filter: "url(#erode-2) contrast(2)",
    description: "Current approach with contrast boost",
  },
  {
    name: "Push Darks (Gentle)",
    filter: "url(#push-darks-gentle)",
    description: "Gamma curve to darken greys, gentle",
  },
  {
    name: "Push Darks",
    filter: "url(#push-darks)",
    description: "Gamma curve to darken greys",
  },
  {
    name: "Push Darks (Strong)",
    filter: "url(#push-darks-strong)",
    description: "Aggressive gamma curve to darken greys",
  },
  {
    name: "Sharpen",
    filter: "url(#sharpen)",
    description: "Edge sharpening convolution",
  },
  {
    name: "Sharpen + Erode 1",
    filter: "url(#sharpen) url(#erode-1)",
    description: "Sharpen first, then erode",
  },
  {
    name: "Sharpen + Erode 1 + Push Darks",
    filter: "url(#sharpen) url(#erode-1) url(#push-darks)",
    description: "Full pipeline: sharpen → erode → push darks",
  },
  {
    name: "Enhanced Lines 1",
    filter: "url(#enhance-lines-1)",
    description: "Combined filter: sharpen + erode 1 + push darks",
  },
  {
    name: "Enhanced Lines 2",
    filter: "url(#enhance-lines-2)",
    description: "Combined filter: sharpen + erode 2 + push darks",
  },
  {
    name: "Enhanced Lines 3",
    filter: "url(#enhance-lines-3)",
    description: "Combined filter: sharpen + erode 3 + push darks",
  },
  {
    name: "Erode 1 + Contrast 3",
    filter: "url(#erode-1) contrast(3)",
    description: "Erode with stronger contrast",
  },
  {
    name: "Erode 1 + Contrast 4",
    filter: "url(#erode-1) contrast(4)",
    description: "Erode with very strong contrast",
  },
  {
    name: "Sharpen + Erode 1 + Contrast 3",
    filter: "url(#sharpen) url(#erode-1) contrast(3)",
    description: "Sharpen → erode → strong contrast",
  },
  {
    name: "Push Darks + Erode 1",
    filter: "url(#push-darks) url(#erode-1)",
    description: "Push darks before eroding",
  },
  {
    name: "Erode 1 + Push Darks",
    filter: "url(#erode-1) url(#push-darks)",
    description: "Erode → push darks (no contrast)",
  },
  {
    name: "Erode 1 + Push Darks + Contrast 1.5",
    filter: "url(#erode-1) url(#push-darks) contrast(1.5)",
    description: "Erode → push darks → mild contrast",
  },
  {
    name: "Erode 1 + Push Darks + Contrast 2",
    filter: "url(#erode-1) url(#push-darks) contrast(2)",
    description: "Erode → push darks → contrast",
  },
  {
    name: "Erode 2 + Push Darks",
    filter: "url(#erode-2) url(#push-darks)",
    description: "Erode 2 → push darks (no contrast)",
  },
  {
    name: "Erode 2 + Push Darks + Contrast 1.5",
    filter: "url(#erode-2) url(#push-darks) contrast(1.5)",
    description: "Erode 2 → push darks → mild contrast",
  },
];

type FileType = "pdf" | "svg" | "test-svg";

export default function RenderingTestPage() {
  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<FileType>("test-svg");
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [selectedFilters, setSelectedFilters] = useState<number[]>([
    0, 4, 11, 12,
  ]);
  const [scale, setScale] = useState(1);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [pdfImageUrl, setPdfImageUrl] = useState<string | null>(null);
  const [pdfDimensions, setPdfDimensions] = useState({ width: 0, height: 0 });
  const [svgDimensions, setSvgDimensions] = useState({ width: 0, height: 0 });
  const [isRendering, setIsRendering] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savedScrollRef = useRef({ left: 0, top: 0 });

  // Test pattern has known dimensions
  const TEST_PATTERN_WIDTH = 600;
  const TEST_PATTERN_HEIGHT = 500;

  // Refs for synchronized scrolling
  const scrollContainersRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const isScrollingRef = useRef(false);
  const activeSourceRef = useRef<number | null>(null);

  // Refs for drag-to-pan
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  const activeContainerIndexRef = useRef<number | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files && files[0]) {
      setFile(files[0]);
      const isPdf = files[0].type === "application/pdf";
      setFileType(isPdf ? "pdf" : "svg");
      setPageNumber(1);
      setPdfImageUrl(null);
      setSvgDimensions({ width: 0, height: 0 });

      // Load SVG dimensions
      if (!isPdf) {
        const img = new Image();
        img.onload = () => {
          setSvgDimensions({
            width: img.naturalWidth,
            height: img.naturalHeight,
          });
        };
        img.src = URL.createObjectURL(files[0]);
      }
    }
  }

  // Render PDF page to canvas and extract as image URL
  const renderPdfToImage = useCallback(async () => {
    if (!file || fileType !== "pdf") return;

    setIsRendering(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;

      // Get page count
      setNumPages(pdf.numPages);

      const page = await pdf.getPage(pageNumber);

      // Render at 2x scale for quality, we'll size it with CSS
      const renderScale = 2;
      const viewport = page.getViewport({ scale: renderScale });

      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");

      if (ctx) {
        await page.render({ canvasContext: ctx, viewport }).promise;
        const dataUrl = canvas.toDataURL("image/png");
        setPdfImageUrl(dataUrl);
        setPdfDimensions({
          width: viewport.width / renderScale,
          height: viewport.height / renderScale,
        });
      }
    } catch (err) {
      console.error("Failed to render PDF:", err);
    } finally {
      setIsRendering(false);
    }
  }, [file, fileType, pageNumber]);

  // Render PDF when file or page changes
  useEffect(() => {
    if (file && fileType === "pdf") {
      renderPdfToImage();
    }
  }, [file, fileType, pageNumber, renderPdfToImage]);

  function toggleFilter(index: number) {
    // Save current scroll position before changing filters
    const firstContainer = scrollContainersRef.current.values().next().value;
    if (firstContainer) {
      savedScrollRef.current = {
        left: firstContainer.scrollLeft,
        top: firstContainer.scrollTop,
      };
    }

    setSelectedFilters((prev) =>
      prev.includes(index)
        ? prev.filter((i) => i !== index)
        : [...prev, index].sort((a, b) => a - b),
    );
  }

  // Restore scroll position after filter change
  useEffect(() => {
    const timer = setTimeout(() => {
      scrollContainersRef.current.forEach((container) => {
        container.scrollLeft = savedScrollRef.current.left;
        container.scrollTop = savedScrollRef.current.top;
      });
    }, 50);
    return () => clearTimeout(timer);
  }, [selectedFilters]);

  function useTestPattern() {
    setFile(null);
    setFileType("test-svg");
  }

  // Synchronized scroll handler - only sync when we're the active source
  const handleScroll = useCallback((sourceIndex: number) => {
    // If we're not the source of the scroll, ignore (prevents echo)
    if (isScrollingRef.current && activeSourceRef.current !== sourceIndex) {
      return;
    }

    const sourceContainer = scrollContainersRef.current.get(sourceIndex);
    if (!sourceContainer) return;

    // Mark this as the active source
    activeSourceRef.current = sourceIndex;
    isScrollingRef.current = true;

    const { scrollLeft, scrollTop } = sourceContainer;

    // Sync to all other containers
    scrollContainersRef.current.forEach((container, index) => {
      if (index !== sourceIndex) {
        container.scrollLeft = scrollLeft;
        container.scrollTop = scrollTop;
      }
    });

    // Reset after a frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        isScrollingRef.current = false;
        activeSourceRef.current = null;
      });
    });
  }, []);

  // Register scroll container ref
  const setScrollRef = useCallback(
    (index: number, element: HTMLDivElement | null) => {
      if (element) {
        scrollContainersRef.current.set(index, element);
      } else {
        scrollContainersRef.current.delete(index);
      }
    },
    [],
  );

  // Drag-to-pan handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, filterIndex: number) => {
      // Prevent default to stop image drag behavior
      e.preventDefault();

      const container = scrollContainersRef.current.get(filterIndex);
      if (!container) return;

      isDraggingRef.current = true;
      activeContainerIndexRef.current = filterIndex;
      activeSourceRef.current = filterIndex; // Set this as scroll source
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
      };
      container.style.cursor = "grabbing";
    },
    [],
  );

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || activeContainerIndexRef.current === null)
      return;

    e.preventDefault();
    const container = scrollContainersRef.current.get(
      activeContainerIndexRef.current,
    );
    if (!container) return;

    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;

    container.scrollLeft = dragStartRef.current.scrollLeft - dx;
    container.scrollTop = dragStartRef.current.scrollTop - dy;
  }, []);

  const handleMouseUp = useCallback(() => {
    if (activeContainerIndexRef.current !== null) {
      const container = scrollContainersRef.current.get(
        activeContainerIndexRef.current,
      );
      if (container) {
        container.style.cursor = "grab";
      }
    }
    isDraggingRef.current = false;
    activeContainerIndexRef.current = null;
  }, []);

  const handleMouseLeave = useCallback(() => {
    // Don't stop dragging on mouse leave - user might move fast
  }, []);

  // Global mouseup listener to catch when user releases outside containers
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDraggingRef.current) {
        handleMouseUp();
      }
    };

    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
  }, [handleMouseUp]);

  // Get theme filter and background
  const getThemeStyles = (theme: ThemeMode) => {
    switch (theme) {
      case "dark":
        return { filter: "invert(1)", bg: "bg-black" };
      case "green":
        return {
          filter: "invert(1) sepia(100%) saturate(300%) hue-rotate(80deg)",
          bg: "bg-black",
        };
      default:
        return { filter: "none", bg: "bg-white" };
    }
  };

  const themeStyles = getThemeStyles(themeMode);
  const hasContent = file || fileType === "test-svg";

  // Calculate grid columns based on number of filters
  const getGridCols = () => {
    const count = selectedFilters.length;
    if (count <= 1) return "grid-cols-1";
    if (count === 2) return "grid-cols-2";
    if (count <= 4) return "grid-cols-2 xl:grid-cols-4";
    if (count <= 6) return "grid-cols-2 lg:grid-cols-3";
    return "grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 overflow-auto">
      <Filters />

      <div className="max-w-full mx-auto">
        <h1 className="text-2xl font-bold mb-4">Rendering Quality Test</h1>

        {/* Controls */}
        <div className="bg-gray-800 rounded-lg p-4 mb-4">
          <div className="flex flex-wrap gap-4 items-center mb-4">
            <button
              onClick={useTestPattern}
              className={`px-4 py-2 rounded ${fileType === "test-svg" && !file ? "bg-green-600" : "bg-gray-600 hover:bg-gray-500"}`}
            >
              Test Pattern
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded"
            >
              {file ? "Change File" : "Load PDF/SVG"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/svg+xml"
              onChange={handleFileChange}
              className="hidden"
            />

            {file && <span className="text-gray-400">{file.name}</span>}

            {file && fileType === "pdf" && (
              <div className="flex items-center gap-2">
                <label>Page:</label>
                <button
                  onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                  disabled={pageNumber <= 1}
                  className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 px-2 py-1 rounded"
                >
                  ←
                </button>
                <span>
                  {pageNumber} / {numPages}
                </span>
                <button
                  onClick={() =>
                    setPageNumber((p) => Math.min(numPages, p + 1))
                  }
                  disabled={pageNumber >= numPages}
                  className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 px-2 py-1 rounded"
                >
                  →
                </button>
              </div>
            )}

            {hasContent && (
              <>
                <div className="flex items-center gap-2">
                  <label className="text-sm">Scale:</label>
                  <input
                    type="range"
                    min="0.5"
                    max="3"
                    step="0.1"
                    value={scale}
                    onChange={(e) => setScale(parseFloat(e.target.value))}
                    className="w-24"
                  />
                  <span className="text-sm w-12">
                    {Math.round(scale * 100)}%
                  </span>
                </div>

                <div className="flex items-center gap-1 bg-gray-700 rounded p-1">
                  <button
                    onClick={() => setThemeMode("light")}
                    className={`px-3 py-1 rounded text-sm ${themeMode === "light" ? "bg-white text-black" : "hover:bg-gray-600"}`}
                  >
                    Light
                  </button>
                  <button
                    onClick={() => setThemeMode("dark")}
                    className={`px-3 py-1 rounded text-sm ${themeMode === "dark" ? "bg-gray-900 text-white ring-1 ring-white" : "hover:bg-gray-600"}`}
                  >
                    Dark
                  </button>
                  <button
                    onClick={() => setThemeMode("green")}
                    className={`px-3 py-1 rounded text-sm ${themeMode === "green" ? "bg-green-600 text-white" : "hover:bg-gray-600"}`}
                  >
                    Green
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Filter selection */}
          <div className="border-t border-gray-700 pt-4">
            <div className="flex items-center gap-4 mb-2">
              <h3 className="font-semibold text-sm">Filters to compare:</h3>
              <button
                onClick={() => setSelectedFilters([0])}
                className="text-xs text-gray-400 hover:text-white"
              >
                Clear
              </button>
              <button
                onClick={() => setSelectedFilters([0, 4, 11, 12])}
                className="text-xs text-gray-400 hover:text-white"
              >
                Reset
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {FILTER_PRESETS.map((preset, index) => (
                <button
                  key={index}
                  onClick={() => toggleFilter(index)}
                  className={`px-2 py-1 rounded text-xs ${
                    selectedFilters.includes(index)
                      ? "bg-blue-600 text-white"
                      : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                  }`}
                  title={preset.description}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Sync scroll hint */}
        {hasContent && selectedFilters.length > 1 && (
          <p className="text-xs text-gray-500 mb-2">
            💡 Click and drag to pan • All panels sync together
          </p>
        )}

        {/* Content comparison grid */}
        {hasContent ? (
          <div className={`grid gap-2 ${getGridCols()}`}>
            {selectedFilters.map((filterIndex) => {
              const preset = FILTER_PRESETS[filterIndex];
              const combinedFilter =
                themeStyles.filter === "none"
                  ? preset.filter
                  : preset.filter === "none"
                    ? themeStyles.filter
                    : `${preset.filter} ${themeStyles.filter}`;

              return (
                <div
                  key={filterIndex}
                  className="bg-gray-800 rounded-lg overflow-hidden flex flex-col"
                >
                  <div className="bg-gray-700 px-2 py-1 flex-shrink-0">
                    <h3 className="font-semibold text-sm">{preset.name}</h3>
                    <code className="text-xs text-blue-400 break-all">
                      {preset.filter === "none" ? "(none)" : preset.filter}
                    </code>
                  </div>
                  <div
                    ref={(el) => setScrollRef(filterIndex, el)}
                    onScroll={() => handleScroll(filterIndex)}
                    onMouseDown={(e) => handleMouseDown(e, filterIndex)}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseLeave}
                    className={`overflow-auto ${themeStyles.bg}`}
                    style={{
                      height: "400px",
                      cursor: "grab",
                    }}
                  >
                    {fileType === "pdf" && file ? (
                      pdfImageUrl ? (
                        <div
                          style={{
                            filter: combinedFilter,
                            width: `${pdfDimensions.width * scale}px`,
                            height: `${pdfDimensions.height * scale}px`,
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={pdfImageUrl}
                            alt="PDF page"
                            draggable={false}
                            onDragStart={(e) => e.preventDefault()}
                            style={{
                              width: "100%",
                              height: "100%",
                              pointerEvents: "none",
                            }}
                          />
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-full text-gray-400">
                          {isRendering ? "Rendering PDF..." : "Loading..."}
                        </div>
                      )
                    ) : fileType === "svg" && file ? (
                      <div
                        style={{
                          filter: combinedFilter,
                          width: svgDimensions.width
                            ? `${svgDimensions.width * scale}px`
                            : "auto",
                          height: svgDimensions.height
                            ? `${svgDimensions.height * scale}px`
                            : "auto",
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={URL.createObjectURL(file)}
                          alt="SVG pattern"
                          draggable={false}
                          onDragStart={(e) => e.preventDefault()}
                          style={{
                            width: "100%",
                            height: "100%",
                            pointerEvents: "none",
                          }}
                        />
                      </div>
                    ) : (
                      <div
                        style={{
                          filter: combinedFilter,
                          width: `${TEST_PATTERN_WIDTH * scale}px`,
                          height: `${TEST_PATTERN_HEIGHT * scale}px`,
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src="/test-pattern.svg?v=2"
                          alt="Test pattern"
                          draggable={false}
                          onDragStart={(e) => e.preventDefault()}
                          style={{
                            width: "100%",
                            height: "100%",
                            pointerEvents: "none",
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-gray-800 rounded-lg p-8 text-center">
            <p className="text-gray-400">
              Load a PDF or SVG to compare rendering approaches
            </p>
          </div>
        )}

        {/* Legend - collapsible */}
        <details className="mt-4 bg-gray-800 rounded-lg">
          <summary className="px-4 py-2 cursor-pointer font-semibold text-sm hover:bg-gray-700 rounded-lg">
            Filter Explanation
          </summary>
          <div className="px-4 pb-4">
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="font-medium text-blue-400">Erosion (erode-N)</dt>
                <dd className="text-gray-400 text-xs">
                  Expands dark pixels. Makes lines thicker but can blur.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-blue-400">
                  Push Darks (gamma)
                </dt>
                <dd className="text-gray-400 text-xs">
                  Gamma curve pushes greys toward black. Preserves
                  anti-aliasing.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-blue-400">Sharpen</dt>
                <dd className="text-gray-400 text-xs">
                  Edge enhancement. Apply before erosion for crispness.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-blue-400">Enhanced Lines</dt>
                <dd className="text-gray-400 text-xs">
                  Combined: sharpen → erode → push darks in one filter.
                </dd>
              </div>
            </dl>
          </div>
        </details>
      </div>
    </div>
  );
}
