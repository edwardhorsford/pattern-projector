"use client";

import { useCallback, useEffect, useState, useRef, ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import {
  useBroadcastChannel,
  BroadcastMessage,
} from "@/_hooks/use-broadcast-channel";
import { Button } from "@/_components/buttons/button";
import { ButtonStyle } from "@/_components/theme/styles";
import { ButtonColor } from "@/_components/theme/colors";
import { IconButton } from "@/_components/buttons/icon-button";
import InlineInput from "@/_components/inline-input";
import FlipHorizontalIcon from "@/_icons/flip-horizontal-icon";
import FlipVerticalIcon from "@/_icons/flip-vertical-icon";
import Rotate90DegreesCWIcon from "@/_icons/rotate-90-degrees-cw-icon";
import RecenterIcon from "@/_icons/recenter-icon";
import InvertColorIcon from "@/_icons/invert-color-icon";
import InvertColorOffIcon from "@/_icons/invert-color-off-icon";
import GridOnIcon from "@/_icons/grid-on-icon";
import GridOffIcon from "@/_icons/grid-off-icon";
import ZoomOutIcon from "@/_icons/zoom-out-icon";
import ZoomInIcon from "@/_icons/zoom-in-icon";
import OverlayBorderIcon from "@/_icons/overlay-border-icon";
import OverlayPaperIcon from "@/_icons/overlay-paper-icon";
import FlipCenterOnIcon from "@/_icons/flip-center-on-icon";
import FlippedPatternIcon from "@/_icons/flipped-pattern-icon";
import LineWeightIcon from "@/_icons/line-weight-icon";
import MarkAndMeasureIcon from "@/_icons/mark-and-measure-icon";
import PdfIcon from "@/_icons/pdf-icon";
import DeleteIcon from "@/_icons/delete-icon";
import MoveIcon from "@/_icons/move-icon";
import TuneIcon from "@/_icons/tune-icon";
import LayersIcon from "@/_icons/layers-icon";
import FlexWrapIcon from "@/_icons/flex-wrap-icon";
import VisibilityIcon from "@/_icons/visibility-icon";
import VisibilityOffIcon from "@/_icons/visibility-off-icon";
import FullScreenIcon from "@/_icons/full-screen-icon";
import FullScreenExitIcon from "@/_icons/full-screen-exit-icon";
import Tooltip from "@/_components/tooltip/tooltip";
import StepperInput from "@/_components/stepper-input";
import InlineSelect from "@/_components/inline-select";
import KeyboardArrowUpIcon from "@/_icons/keyboard-arrow-up";
import KeyboardArrowDownIcon from "@/_icons/keyboard-arrow-down";
import KeyboardArrowLeftIcon from "@/_icons/keyboard-arrow-left";
import KeyboardArrowRightIcon from "@/_icons/keyboard-arrow-right";
import CycleIcon from "@/_icons/cycle-icon";
import { Direction } from "@/_lib/direction";
import {
  DisplaySettings,
  getDefaultDisplaySettings,
  isDarkTheme,
  strokeColor,
  themeFilter,
  Theme,
} from "@/_lib/display-settings";
import { rotateRange } from "@/_lib/get-page-numbers";
import { Unit } from "@/_lib/unit";
import { Layers } from "@/_lib/layers";
import {
  StitchSettings,
  LineDirection,
} from "@/_lib/interfaces/stitch-settings";

// Default stitch settings for initial state
const defaultStitchSettings: StitchSettings = {
  key: "",
  pageRange: "",
  lineCount: 0,
  edgeInsets: { horizontal: 0, vertical: 0 },
  lineDirection: LineDirection.Column,
};

// Viewport bounds for mini map (in PDF coordinate space)
interface ViewportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // Current rotation in degrees
  // Normalized transform matrix components (rotation + flip, no scale/translation)
  // These form a 2x2 matrix: [[a, b], [c, d]]
  transformA: number;
  transformB: number;
  transformC: number;
  transformD: number;
  hasFlip: boolean; // Whether there's any flip (determinant < 0)
}

// Calibration bounds for mini map border (in PDF coordinate space)
interface CalibrationBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Paper bounds for mini map paper sheet overlay (in PDF coordinate space)
// Uses same structure as CalibrationBounds
type PaperBounds = CalibrationBounds;

// State synced from main window
interface SyncedState {
  isCalibrating: boolean;
  displaySettings: DisplaySettings;
  zoomedOut: boolean;
  magnifying: boolean;
  isMagnified: boolean; // Whether actively zoomed in (magnify mode + already magnified)
  measuring: boolean;
  file: { name: string; type: string } | null;
  connected: boolean;
  lineThickness: number;
  pageCount: number;
  patternScale: string;
  menuStates: {
    layers: boolean;
    stitch: boolean;
    scale: boolean;
  };
  widthInput: string;
  heightInput: string;
  unitOfMeasure: string;
  layers: Layers;
  stitchSettings: StitchSettings;
  showingMovePad: boolean;
  corners: number[];
  // Preview data
  previewImage: string | null; // Data URL of the PDF thumbnail
  isPreviewLoading: boolean; // Whether the preview is being generated
  showPreviewImage: boolean; // Whether to show the PDF preview
  viewportBounds: ViewportBounds | null; // Current viewport in PDF coordinates
  calibrationBounds: CalibrationBounds | null; // Fixed calibration rectangle in PDF coordinates
  paperBounds: PaperBounds | null; // Paper sheet rectangle in PDF coordinates
  layoutWidth: number;
  layoutHeight: number;
}

const defaultSyncedState: SyncedState = {
  isCalibrating: true,
  displaySettings: getDefaultDisplaySettings(),
  zoomedOut: false,
  magnifying: false,
  isMagnified: false,
  measuring: false,
  file: null,
  connected: false,
  lineThickness: 0,
  pageCount: 0,
  patternScale: "1.00",
  menuStates: {
    layers: false,
    stitch: false,
    scale: false,
  },
  widthInput: "24",
  heightInput: "16",
  unitOfMeasure: Unit.IN,
  layers: {},
  stitchSettings: defaultStitchSettings,
  showingMovePad: false,
  corners: [0],
  // Preview defaults
  previewImage: null,
  isPreviewLoading: false,
  showPreviewImage: true,
  viewportBounds: null,
  calibrationBounds: null,
  paperBounds: null,
  layoutWidth: 0,
  layoutHeight: 0,
};

// Dropdown menu component with close callback
function DropdownMenu({
  trigger,
  children,
  className = "",
  closeOnSelect = false,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  className?: string;
  closeOnSelect?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const close = () => setIsOpen(false);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <div onClick={() => setIsOpen(!isOpen)}>{trigger}</div>
      {isOpen && (
        <div
          className="absolute left-0 mt-1 bg-white dark:bg-gray-800 rounded-md shadow-lg z-50 border dark:border-gray-700"
          onClick={closeOnSelect ? close : undefined}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

// Checkbox menu item
function CheckboxMenuItem({
  icon,
  label,
  checked,
  onChange,
  disabled = false,
}: {
  icon?: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="w-4 h-4 accent-purple-600 rounded"
      />
      {icon}
      <span>{label}</span>
    </label>
  );
}

// Section header for grouping
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2 mt-3 first:mt-0">
      {children}
    </h3>
  );
}

// Preview component for bird's eye view navigation
function Preview({
  layoutWidth,
  layoutHeight,
  viewportBounds,
  calibrationBounds,
  paperBounds,
  previewImage,
  isPreviewLoading,
  showPreviewImage,
  showBorder,
  showPaper,
  theme,
  magnifying,
  isMagnified,
  enlarged,
  onNavigate,
  onPanDelta,
  onMagnify,
  onTogglePreview,
  onToggleSize,
  t,
}: {
  layoutWidth: number;
  layoutHeight: number;
  viewportBounds: ViewportBounds | null;
  calibrationBounds: CalibrationBounds | null;
  paperBounds: PaperBounds | null;
  previewImage: string | null;
  isPreviewLoading: boolean;
  showPreviewImage: boolean;
  showBorder: boolean;
  showPaper: boolean;
  theme: Theme;
  magnifying: boolean;
  isMagnified: boolean;
  enlarged: boolean;
  onNavigate: (x: number, y: number) => void;
  onPanDelta: (dx: number, dy: number) => void;
  onMagnify: (x: number, y: number) => void;
  onTogglePreview: () => void;
  onToggleSize: () => void;
  t: ReturnType<typeof useTranslations<"ControlPanel">>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [containerWidth, setContainerWidth] = useState(400);
  const lastNavigateTime = useRef(0);
  const handledMagnifyClick = useRef(false); // Track if we handled a magnify click
  const dragStartCoords = useRef<{ x: number; y: number } | null>(null); // Track drag start for delta calculation
  const lastDragCoords = useRef<{ x: number; y: number } | null>(null); // Track last drag position
  const throttleMs = 16; // Throttle navigation updates (~60fps)
  
  // Track absolute viewport position during drag for perfect 1:1 cursor tracking
  // Instead of accumulating deltas, we compute position from drag start + mouse movement
  const dragStartScreenPos = useRef<{ x: number; y: number } | null>(null);
  const dragStartViewportCenter = useRef<{ x: number; y: number } | null>(null);
  const [localViewportCenter, setLocalViewportCenter] = useState<{ x: number; y: number } | null>(null);

  // Measure available width from parent container
  useEffect(() => {
    const updateWidth = () => {
      if (wrapperRef.current) {
        // Get the width of the wrapper (minus some padding for aesthetics)
        const availableWidth = wrapperRef.current.offsetWidth;
        setContainerWidth(availableWidth);
      }
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  // Calculate scale to fit the PDF in the preview container
  // Both sizes are capped to prevent size jumps when rotating
  // Normal: 400px max, Enlarged: 800px max
  const maxWidth = Math.min(containerWidth, enlarged ? 800 : 400);
  const maxHeight = enlarged ? 675 : 450;

  if (layoutWidth === 0 || layoutHeight === 0) {
    return (
      <div ref={wrapperRef} className="w-full">
        <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-4 text-center text-sm text-gray-500 dark:text-gray-400">
          {t("previewNoFile")}
        </div>
      </div>
    );
  }

  // Get rotation and normalize to 0, 90, 180, 270
  const rotation = viewportBounds?.rotation ?? 0;
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const isRotated90or270 =
    (normalizedRotation > 45 && normalizedRotation < 135) ||
    (normalizedRotation > 225 && normalizedRotation < 315);
  const isRotated180 = normalizedRotation > 135 && normalizedRotation < 225;

  // Get the normalized transform matrix from viewport bounds
  // This represents the exact rotation + flip transformation
  const transformA = viewportBounds?.transformA ?? 1;
  const transformB = viewportBounds?.transformB ?? 0;
  const transformC = viewportBounds?.transformC ?? 0;
  const transformD = viewportBounds?.transformD ?? 1;
  const hasFlip = viewportBounds?.hasFlip ?? false;

  // When rotated 90/270 and "rotate with view" is on, swap effective dimensions
  const effectiveLayoutWidth = isRotated90or270 ? layoutHeight : layoutWidth;
  const effectiveLayoutHeight = isRotated90or270 ? layoutWidth : layoutHeight;

  // Add buffer around the PDF to show when view goes off-edge
  // Use uniform buffer based on the smaller dimension for consistent appearance
  const smallerDimension = Math.min(
    effectiveLayoutWidth,
    effectiveLayoutHeight,
  );
  const buffer = smallerDimension * 0.15;
  const bufferX = buffer;
  const bufferY = buffer;

  // Total area including buffer
  const totalWidth = effectiveLayoutWidth + bufferX * 2;
  const totalHeight = effectiveLayoutHeight + bufferY * 2;

  const scale = Math.min(maxWidth / totalWidth, maxHeight / totalHeight);
  const scaledWidth = totalWidth * scale;
  const scaledHeight = totalHeight * scale;
  const scaledBufferX = bufferX * scale;
  const scaledBufferY = bufferY * scale;

  // Convert screen coordinates to PDF coordinates
  // Uses the inverse of the transform matrix to correctly handle any rotation + flip combination
  const screenToPdfCoords = (
    screenX: number,
    screenY: number,
  ): { x: number; y: number } => {
    // Get position relative to the PDF area center
    const centerX = scaledBufferX + (effectiveLayoutWidth * scale) / 2;
    const centerY = scaledBufferY + (effectiveLayoutHeight * scale) / 2;

    // Position relative to center, in PDF units
    const relX = (screenX - centerX) / scale;
    const relY = (screenY - centerY) / scale;

    // Apply inverse of the transform matrix to get back to original PDF coordinates
    // The transform matrix is [a, b; c, d], so inverse is (1/det) * [d, -b; -c, a]
    const det = transformA * transformD - transformB * transformC;
    if (Math.abs(det) < 0.0001) {
      // Fallback for degenerate matrix
      return {
        x: layoutWidth / 2 + relX,
        y: layoutHeight / 2 + relY,
      };
    }

    // Apply inverse transform
    const invA = transformD / det;
    const invB = -transformB / det;
    const invC = -transformC / det;
    const invD = transformA / det;

    const pdfRelX = invA * relX + invB * relY;
    const pdfRelY = invC * relX + invD * relY;

    // Convert back to PDF coordinates (from center-relative)
    const pdfX = layoutWidth / 2 + pdfRelX;
    const pdfY = layoutHeight / 2 + pdfRelY;

    return { x: pdfX, y: pdfY };
  };

  // Handle pointer events for click and drag
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;

    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const coords = screenToPdfCoords(
      e.clientX - rect.left,
      e.clientY - rect.top,
    );

    // If magnifying mode is active, trigger magnify at this point instead of navigating
    if (magnifying) {
      handledMagnifyClick.current = true;
      onMagnify(coords.x, coords.y);
      return;
    }

    setIsDragging(true);
    containerRef.current.setPointerCapture(e.pointerId);
    lastNavigateTime.current = Date.now();
    // Store the starting position for drag delta calculation
    dragStartCoords.current = coords;
    lastDragCoords.current = { x: e.clientX, y: e.clientY }; // Track screen position
    
    // Store absolute positions for perfect 1:1 cursor tracking
    // The clicked point becomes the new viewport center
    dragStartScreenPos.current = { x: e.clientX, y: e.clientY };
    dragStartViewportCenter.current = coords; // Click point = new center
    setLocalViewportCenter(coords);
    
    // Initial click: center on this point
    onNavigate(coords.x, coords.y);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !containerRef.current || !dragStartScreenPos.current || !dragStartViewportCenter.current) return;

    // Calculate how far mouse has moved from drag start (in screen pixels)
    const screenDeltaX = e.clientX - dragStartScreenPos.current.x;
    const screenDeltaY = e.clientY - dragStartScreenPos.current.y;
    
    // Convert screen delta to PDF coordinates
    // Moving mouse right in preview = viewport moves right in PDF space
    const pdfDeltaX = screenDeltaX / scale;
    const pdfDeltaY = screenDeltaY / scale;
    
    // Compute absolute viewport center: start position + mouse movement
    // This gives perfect 1:1 tracking - the viewport follows the cursor exactly
    const newCenter = {
      x: dragStartViewportCenter.current.x + pdfDeltaX,
      y: dragStartViewportCenter.current.y + pdfDeltaY,
    };
    setLocalViewportCenter(newCenter);

    // Throttle the actual navigation commands to the main window
    const now = Date.now();
    if (now - lastNavigateTime.current < throttleMs) return;
    lastNavigateTime.current = now;

    // Calculate delta from last sent position for the main window
    const lastScreenDeltaX = e.clientX - lastDragCoords.current!.x;
    const lastScreenDeltaY = e.clientY - lastDragCoords.current!.y;
    lastDragCoords.current = { x: e.clientX, y: e.clientY };

    // Convert screen delta to main window pixels (negated for pan direction)
    const mainWindowDeltaX = -lastScreenDeltaX / scale;
    const mainWindowDeltaY = -lastScreenDeltaY / scale;

    if (Math.abs(mainWindowDeltaX) > 0.5 || Math.abs(mainWindowDeltaY) > 0.5) {
      onPanDelta(mainWindowDeltaX, mainWindowDeltaY);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;

    // If we handled a magnify click, don't navigate on pointer up
    if (handledMagnifyClick.current) {
      handledMagnifyClick.current = false;
      return;
    }

    setIsDragging(false);
    containerRef.current.releasePointerCapture(e.pointerId);
    dragStartCoords.current = null;
    lastDragCoords.current = null;
    dragStartScreenPos.current = null;
    dragStartViewportCenter.current = null;
    // Clear local viewport - synced state is now accurate
    setLocalViewportCenter(null);
  };

  // Transform a point from PDF coordinates to mini map display coordinates
  // Uses the transform matrix to correctly handle any rotation + flip combination
  const pdfToDisplayCoords = (
    pdfX: number,
    pdfY: number,
  ): { x: number; y: number } => {
    // Convert to center-relative coordinates
    const relX = pdfX - layoutWidth / 2;
    const relY = pdfY - layoutHeight / 2;

    // Apply transform matrix
    const transformedX = transformA * relX + transformB * relY;
    const transformedY = transformC * relX + transformD * relY;

    // Convert to display coordinates (accounting for buffer and scale)
    // The effective layout is centered in the display area
    const displayX =
      scaledBufferX + (effectiveLayoutWidth * scale) / 2 + transformedX * scale;
    const displayY =
      scaledBufferY +
      (effectiveLayoutHeight * scale) / 2 +
      transformedY * scale;

    return { x: displayX, y: displayY };
  };

  // Calculate viewport indicator position and size
  const getViewportIndicator = () => {
    if (!viewportBounds) return null;

    // When dragging, use local viewport center for perfect 1:1 cursor tracking
    // Otherwise use the synced viewport bounds
    let effectiveBounds = viewportBounds;
    if (localViewportCenter && isDragging) {
      // Compute bounds centered on local viewport center
      // The width/height stay the same, just the position changes
      effectiveBounds = {
        ...viewportBounds,
        x: localViewportCenter.x - viewportBounds.width / 2,
        y: localViewportCenter.y - viewportBounds.height / 2,
      };
    }

    // Transform the four corners of the viewport bounds
    const corners = [
      pdfToDisplayCoords(effectiveBounds.x, effectiveBounds.y),
      pdfToDisplayCoords(
        effectiveBounds.x + effectiveBounds.width,
        effectiveBounds.y,
      ),
      pdfToDisplayCoords(
        effectiveBounds.x + effectiveBounds.width,
        effectiveBounds.y + effectiveBounds.height,
      ),
      pdfToDisplayCoords(
        effectiveBounds.x,
        effectiveBounds.y + effectiveBounds.height,
      ),
    ];

    // Get bounding box of transformed corners
    const minX = Math.min(...corners.map((c) => c.x));
    const maxX = Math.max(...corners.map((c) => c.x));
    const minY = Math.min(...corners.map((c) => c.y));
    const maxY = Math.max(...corners.map((c) => c.y));

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      rotation: viewportBounds.rotation,
    };
  };

  // Calculate calibration border position (similar to viewport but uses calibrationBounds)
  const getCalibrationBorderIndicator = () => {
    if (!calibrationBounds) return null;

    // Transform the four corners of the calibration bounds
    const corners = [
      pdfToDisplayCoords(calibrationBounds.x, calibrationBounds.y),
      pdfToDisplayCoords(
        calibrationBounds.x + calibrationBounds.width,
        calibrationBounds.y,
      ),
      pdfToDisplayCoords(
        calibrationBounds.x + calibrationBounds.width,
        calibrationBounds.y + calibrationBounds.height,
      ),
      pdfToDisplayCoords(
        calibrationBounds.x,
        calibrationBounds.y + calibrationBounds.height,
      ),
    ];

    // Get bounding box of transformed corners
    const minX = Math.min(...corners.map((c) => c.x));
    const maxX = Math.max(...corners.map((c) => c.x));
    const minY = Math.min(...corners.map((c) => c.y));
    const maxY = Math.max(...corners.map((c) => c.y));

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  };

  // Calculate paper sheet position (similar to calibration border but uses paperBounds)
  const getPaperIndicator = () => {
    if (!paperBounds) return null;

    // Transform the four corners of the paper bounds
    const corners = [
      pdfToDisplayCoords(paperBounds.x, paperBounds.y),
      pdfToDisplayCoords(paperBounds.x + paperBounds.width, paperBounds.y),
      pdfToDisplayCoords(
        paperBounds.x + paperBounds.width,
        paperBounds.y + paperBounds.height,
      ),
      pdfToDisplayCoords(paperBounds.x, paperBounds.y + paperBounds.height),
    ];

    // Get bounding box of transformed corners
    const minX = Math.min(...corners.map((c) => c.x));
    const maxX = Math.max(...corners.map((c) => c.x));
    const minY = Math.min(...corners.map((c) => c.y));
    const maxY = Math.max(...corners.map((c) => c.y));

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  };

  const viewport = getViewportIndicator();
  const calibrationBorder = getCalibrationBorderIndicator();
  const paperSheet = getPaperIndicator();

  return (
    <div ref={wrapperRef} className="space-y-2 w-full">
      <div className="flex items-center gap-1">
        <Tooltip
          description={
            showPreviewImage ? t("previewHideImage") : t("previewShowImage")
          }
        >
          <IconButton onClick={onTogglePreview}>
            {showPreviewImage ? (
              <VisibilityIcon ariaLabel={t("previewHideImage")} />
            ) : (
              <VisibilityOffIcon ariaLabel={t("previewShowImage")} />
            )}
          </IconButton>
        </Tooltip>
        <Tooltip
          description={enlarged ? t("previewShrink") : t("previewEnlarge")}
        >
          <IconButton onClick={onToggleSize}>
            {enlarged ? (
              <FullScreenIcon ariaLabel={t("previewShrink")} />
            ) : (
              <FullScreenExitIcon ariaLabel={t("previewEnlarge")} />
            )}
          </IconButton>
        </Tooltip>
      </div>
      <div
        ref={containerRef}
        className="relative bg-gray-300 dark:bg-gray-700 rounded-lg overflow-hidden mx-auto"
        style={{
          width: scaledWidth,
          height: scaledHeight,
          touchAction: "none", // Prevent scrolling while dragging
          // Inline cursor style - zoom-in/zoom-out may not work in Safari
          cursor: isMagnified
            ? "zoom-out"
            : magnifying
              ? "zoom-in"
              : isDragging
                ? "grabbing"
                : "crosshair",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* PDF area representation */}
        <div
          className="absolute bg-white dark:bg-gray-800 border border-gray-400 dark:border-gray-500 overflow-hidden"
          style={{
            left: scaledBufferX,
            top: scaledBufferY,
            width: effectiveLayoutWidth * scale,
            height: effectiveLayoutHeight * scale,
          }}
        >
          {/* Loading indicator */}
          {isPreviewLoading && showPreviewImage && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-gray-800/50">
              <div className="w-6 h-6 border-2 border-gray-300 dark:border-gray-600 border-t-purple-500 rounded-full animate-spin" />
            </div>
          )}
          {/* PDF thumbnail image */}
          {showPreviewImage && previewImage && (
            <img
              src={previewImage}
              alt=""
              className="pointer-events-none"
              style={{
                // Use CSS matrix transform to apply the exact same transformation
                // as the main view (rotation + flip in correct order)
                position: "absolute" as const,
                top: "50%",
                left: "50%",
                // Size the image based on whether axes are swapped
                width: isRotated90or270
                  ? effectiveLayoutHeight * scale
                  : effectiveLayoutWidth * scale,
                height: isRotated90or270
                  ? effectiveLayoutWidth * scale
                  : effectiveLayoutHeight * scale,
                // Use CSS matrix() to apply the exact transform
                // matrix(a, c, b, d, tx, ty) - note CSS uses column-major order
                transform: `translate(-50%, -50%) matrix(${transformA}, ${transformC}, ${transformB}, ${transformD}, 0, 0)`,
                transformOrigin: "center center",
                // Apply theme filter (invert for dark themes)
                filter: themeFilter(theme),
              }}
              draggable={false}
            />
          )}
        </div>

        {/* Calibration border - shows the original calibration rectangle */}
        {showBorder && calibrationBorder && (
          <div
            className="absolute border-2 border-purple-500 pointer-events-none"
            style={{
              left: calibrationBorder.x,
              top: calibrationBorder.y,
              width: Math.max(calibrationBorder.width, 4),
              height: Math.max(calibrationBorder.height, 4),
            }}
          />
        )}

        {/* Paper sheet indicator - shows A4/Letter paper size rectangle */}
        {showPaper && paperSheet && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: paperSheet.x,
              top: paperSheet.y,
              width: Math.max(paperSheet.width, 4),
              height: Math.max(paperSheet.height, 4),
              border: "2px dashed #9333ea",
            }}
          />
        )}

        {/* Viewport indicator */}
        {viewport && (
          <div
            className="absolute border-2 border-purple-500 pointer-events-none"
            style={{
              left: viewport.x,
              top: viewport.y,
              width: Math.max(viewport.width, 4),
              height: Math.max(viewport.height, 4),
              // No transform needed - viewport is already in rotated coordinates
              transformOrigin: "top left",
              backgroundColor: "rgba(147, 51, 234, 0.15)",
            }}
          />
        )}

        {/* Center crosshair when no viewport */}
        {!viewport && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-4 h-0.5 bg-purple-500" />
            <div className="absolute w-0.5 h-4 bg-purple-500" />
          </div>
        )}
      </div>
    </div>
  );
}

// Movement pad constants
const PIXEL_LIST = [1, 4, 8, 16];
const REPEAT_MS = 100;
const REPEAT_PX_COUNT = 6;

// Movement pad for control panel - can be used for calibration (moving corners) or projecting (panning view)
function MovementPadControl({
  mode,
  corners,
  handleAction,
  t,
}: {
  mode: "calibrate" | "project";
  corners: number[];
  handleAction: (action: string, params?: unknown) => void;
  t: ReturnType<typeof useTranslations<"MovementPad">>;
}) {
  const [intervalFunc, setIntervalFunc] = useState<NodeJS.Timeout | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);
  const border = "border-2 border-purple-600";

  // Track shift key for 10x speed
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setShiftHeld(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Get effective pixels based on shift key
  const getEffectivePixels = (basePixels: number) => {
    return shiftHeld ? basePixels * 10 : basePixels;
  };

  const handleStart = (direction: Direction) => {
    // First immediate move
    const initialPixels = getEffectivePixels(PIXEL_LIST[0]);
    if (mode === "calibrate") {
      handleAction("moveCorner", { direction, pixels: initialPixels });
    } else {
      handleAction("panView", { direction, pixels: initialPixels });
    }

    // Then repeated moves with acceleration
    let i = 0;
    const interval = setInterval(() => {
      if (i < PIXEL_LIST.length * REPEAT_PX_COUNT - 1) {
        ++i;
      }
      const pixels = getEffectivePixels(
        PIXEL_LIST[Math.floor(i / REPEAT_PX_COUNT)],
      );
      if (mode === "calibrate") {
        handleAction("moveCorner", { direction, pixels });
      } else {
        handleAction("panView", { direction, pixels });
      }
    }, REPEAT_MS);
    setIntervalFunc(interval);
  };

  const handleStop = () => {
    if (intervalFunc) {
      clearInterval(intervalFunc);
      setIntervalFunc(null);
    }
    // Save calibration context after move (only in calibrate mode)
    if (mode === "calibrate") {
      handleAction("saveCalibrationContext");
    }
  };

  const handleCycle = () => {
    if (mode === "calibrate") {
      handleAction("cycleCorner");
    } else {
      // In project mode, the center button rotates the view
      handleAction("rotateView", 15);
    }
  };

  // Get corner label for calibrate mode
  const getCornerLabel = () => {
    if (corners.length === 0) return "";
    if (corners.length === 4) return t("allCorners");
    const labels = ["TL", "TR", "BR", "BL"];
    return corners.map((c) => labels[c]).join(", ");
  };

  return (
    <div className="flex flex-col items-center gap-2">
      {mode === "calibrate" && (
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {t("selectedCorner")}: {getCornerLabel()}
        </div>
      )}
      <menu className="grid grid-cols-3 gap-2">
        <IconButton
          style={{ WebkitUserSelect: "none", userSelect: "none" }}
          onPointerDown={() => handleStart(Direction.Up)}
          onPointerUp={handleStop}
          onPointerLeave={handleStop}
          className={`${border} col-start-2`}
        >
          <KeyboardArrowUpIcon ariaLabel={t("up")} />
        </IconButton>

        <IconButton
          style={{ WebkitUserSelect: "none", userSelect: "none" }}
          onPointerDown={() => handleStart(Direction.Left)}
          onPointerUp={handleStop}
          onPointerLeave={handleStop}
          className={`${border} col-start-1`}
        >
          <KeyboardArrowLeftIcon ariaLabel={t("left")} />
        </IconButton>

        <IconButton
          style={{ WebkitUserSelect: "none", userSelect: "none" }}
          onClick={handleCycle}
          className={`${border} col-start-2`}
        >
          {mode === "calibrate" ? (
            <CycleIcon ariaLabel={t("next")} />
          ) : (
            <Rotate90DegreesCWIcon ariaLabel={t("rotate")} />
          )}
        </IconButton>

        <IconButton
          style={{ WebkitUserSelect: "none", userSelect: "none" }}
          onPointerDown={() => handleStart(Direction.Right)}
          onPointerUp={handleStop}
          onPointerLeave={handleStop}
          className={`${border} col-start-3`}
        >
          <KeyboardArrowRightIcon ariaLabel={t("right")} />
        </IconButton>

        <IconButton
          style={{ WebkitUserSelect: "none", userSelect: "none" }}
          onPointerDown={() => handleStart(Direction.Down)}
          onPointerUp={handleStop}
          onPointerLeave={handleStop}
          className={`${border} col-start-2`}
        >
          <KeyboardArrowDownIcon ariaLabel={t("down")} />
        </IconButton>
      </menu>
    </div>
  );
}

export default function ControlPanelPage() {
  const t = useTranslations("ControlPanel");
  const tHeader = useTranslations("Header");
  const tStitch = useTranslations("StitchMenu");
  const tLayers = useTranslations("LayerMenu");
  const tScale = useTranslations("ScaleMenu");
  const tMove = useTranslations("MovementPad");
  const [state, setState] = useState<SyncedState>(defaultSyncedState);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Local state for which side panel is open (like main window)
  const [activePanel, setActivePanel] = useState<
    "stitch" | "layers" | "scale" | null
  >(null);
  // Local state for control panel move pads (independent from main window)
  const [showCalibrateMovepad, setShowCalibrateMovepad] = useState(false);
  const [showProjectMovepad, setShowProjectMovepad] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(true);
  const [previewEnlarged, setPreviewEnlarged] = useState(false); // Toggle between compact and large view

  // Handle incoming messages from main window
  const handleMessage = useCallback((message: BroadcastMessage) => {
    if (message.type === "state-sync") {
      const payload = message.payload as Record<string, unknown>;
      setState((prev) => ({
        ...prev,
        ...payload,
        connected: true,
      }));
      setLastSync(message.timestamp);
    }
  }, []);

  const { sendAction, requestSync, sendFile } =
    useBroadcastChannel(handleMessage);

  // Request initial sync on mount and periodically
  useEffect(() => {
    requestSync();
    const interval = setInterval(() => {
      requestSync();
    }, 1000);
    return () => clearInterval(interval);
  }, [requestSync]);

  const handleAction = (action: string, params?: unknown) => {
    sendAction(action, params);
  };

  // Handle file selection in control panel - send to main window
  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      sendFile(file.name, file.type, arrayBuffer);
    } catch (error) {
      console.error("Error reading file:", error);
    }
    e.target.value = "";
  };

  const handleOpenFile = () => {
    fileInputRef.current?.click();
  };

  const isConnected =
    state.connected && lastSync && Date.now() - lastSync < 5000;
  const hasFile = state.file !== null;
  const isPdf = state.file?.type === "application/pdf";
  const isProjecting = !state.isCalibrating;
  const isDark = isDarkTheme(state.displaySettings.theme);
  const overlaysDisabled = state.displaySettings.overlay?.disabled;

  const lineThicknessOptions = [0, 1, 2, 3, 4, 5, 6, 7];

  return (
    <main
      className={`h-screen overflow-y-auto p-4 ${isDark ? "dark bg-gray-900 text-white" : "bg-gray-100"}`}
    >
      <div className="w-full">
        {/* Header */}
        <header className="mb-4 pb-3 border-b dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold">{t("title")}</h1>
              <div className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`}
                />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {isConnected ? t("connected") : t("disconnected")}
                </span>
              </div>
            </div>
            {/* Mode Toggle Button */}
            <Button
              onClick={() =>
                handleAction(
                  state.isCalibrating ? "saveAndProject" : "toggleMode",
                )
              }
              className="px-4"
              style={ButtonStyle.FILLED}
              color={ButtonColor.PURPLE}
            >
              {state.isCalibrating ? tHeader("project") : tHeader("calibrate")}
            </Button>
          </div>
        </header>

        {/* ===== CALIBRATE MODE ===== */}
        {state.isCalibrating && (
          <div className="space-y-4">
            {/* Display Options - matches left menu group */}
            <section className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
              <SectionHeader>{t("displaySettings")}</SectionHeader>
              <div className="flex items-center gap-2">
                <Tooltip description={tHeader("invertColor")}>
                  <IconButton onClick={() => handleAction("toggleTheme")}>
                    {isDark ? (
                      <InvertColorIcon
                        fill={strokeColor(state.displaySettings.theme)}
                        ariaLabel={tHeader("invertColor")}
                      />
                    ) : (
                      <InvertColorOffIcon ariaLabel={tHeader("invertColor")} />
                    )}
                  </IconButton>
                </Tooltip>
              </div>
            </section>

            {/* Calibration Size - matches center group */}
            <section className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
              <SectionHeader>{t("calibrationSize")}</SectionHeader>
              <div className="flex items-center gap-1">
                <InlineInput
                  className="relative flex flex-col"
                  inputClassName="pl-6 pr-7 w-24"
                  handleChange={(e) => handleAction("setWidth", e.target.value)}
                  id="width"
                  label={tHeader("width")}
                  labelRight={(state.unitOfMeasure ?? Unit.IN).toLowerCase()}
                  name="width"
                  value={state.widthInput}
                  type="number"
                  min="0"
                />
                <InlineInput
                  className="relative flex flex-col"
                  inputClassName="pl-6 pr-7 w-24"
                  handleChange={(e) =>
                    handleAction("setHeight", e.target.value)
                  }
                  id="height"
                  label={tHeader("height")}
                  labelRight={(state.unitOfMeasure ?? Unit.IN).toLowerCase()}
                  name="height"
                  value={state.heightInput}
                  type="number"
                  min="0"
                />
                <InlineSelect
                  handleChange={(e) => handleAction("setUnit", e.target.value)}
                  id="unit_of_measure"
                  name="unit_of_measure"
                  value={state.unitOfMeasure ?? Unit.IN}
                  options={[
                    { value: Unit.IN, label: "in" },
                    { value: Unit.CM, label: "cm" },
                  ]}
                />
                <Tooltip description={tHeader("delete")}>
                  <IconButton onClick={() => handleAction("resetCalibration")}>
                    <DeleteIcon ariaLabel={tHeader("delete")} />
                  </IconButton>
                </Tooltip>
                <Tooltip
                  description={
                    showCalibrateMovepad
                      ? tHeader("hideMovement")
                      : tHeader("showMovement")
                  }
                >
                  <IconButton
                    onClick={() =>
                      setShowCalibrateMovepad(!showCalibrateMovepad)
                    }
                    active={showCalibrateMovepad}
                  >
                    <MoveIcon ariaLabel={tHeader("showMovement")} />
                  </IconButton>
                </Tooltip>
              </div>
              {/* Movement Pad for Calibration */}
              {showCalibrateMovepad && (
                <div className="mt-4">
                  <MovementPadControl
                    mode="calibrate"
                    corners={state.corners}
                    handleAction={handleAction}
                    t={tMove}
                  />
                </div>
              )}
            </section>
          </div>
        )}

        {/* ===== PROJECT MODE ===== */}
        {isProjecting && (
          <div className="space-y-4">
            {/* Open File */}
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/svg+xml"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                onClick={handleOpenFile}
                className="w-full flex items-center justify-center gap-2"
              >
                <PdfIcon ariaLabel="" fill="currentColor" />
                {hasFile ? state.file?.name : tHeader("openPDF")}
              </Button>
            </div>

            {/* Display Options - matches left menu group */}
            <section className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
              <SectionHeader>{t("displaySettings")}</SectionHeader>
              <div className="flex flex-wrap items-center gap-1">
                {/* Invert Colors */}
                <Tooltip description={tHeader("invertColor")}>
                  <IconButton onClick={() => handleAction("toggleTheme")}>
                    {isDark ? (
                      <InvertColorIcon
                        fill={strokeColor(state.displaySettings.theme)}
                        ariaLabel={tHeader("invertColor")}
                      />
                    ) : (
                      <InvertColorOffIcon ariaLabel={tHeader("invertColor")} />
                    )}
                  </IconButton>
                </Tooltip>

                {/* Overlay Options Dropdown */}
                <DropdownMenu
                  trigger={
                    <Tooltip description={tHeader("overlayOptions")}>
                      <IconButton>
                        {overlaysDisabled ? (
                          <GridOffIcon ariaLabel={tHeader("overlayOptions")} />
                        ) : (
                          <GridOnIcon ariaLabel={tHeader("overlayOptions")} />
                        )}
                      </IconButton>
                    </Tooltip>
                  }
                >
                  <div className="py-1 min-w-48">
                    <CheckboxMenuItem
                      icon={<GridOffIcon ariaLabel="" />}
                      label={tHeader("overlayOptionDisabled")}
                      checked={!!state.displaySettings.overlay?.disabled}
                      onChange={() => handleAction("toggleOverlay", "disabled")}
                    />
                    <CheckboxMenuItem
                      icon={<GridOnIcon ariaLabel="" />}
                      label={tHeader("overlayOptionGrid")}
                      checked={!!state.displaySettings.overlay?.grid}
                      onChange={() => handleAction("toggleOverlay", "grid")}
                      disabled={overlaysDisabled}
                    />
                    <CheckboxMenuItem
                      icon={<OverlayBorderIcon ariaLabel="" />}
                      label={tHeader("overlayOptionBorder")}
                      checked={!!state.displaySettings.overlay?.border}
                      onChange={() => handleAction("toggleOverlay", "border")}
                      disabled={overlaysDisabled}
                    />
                    <CheckboxMenuItem
                      icon={<OverlayPaperIcon ariaLabel="" />}
                      label={tHeader("overlayOptionPaper")}
                      checked={!!state.displaySettings.overlay?.paper}
                      onChange={() => handleAction("toggleOverlay", "paper")}
                      disabled={overlaysDisabled}
                    />
                    <CheckboxMenuItem
                      icon={<FlipCenterOnIcon ariaLabel="" />}
                      label={tHeader("overlayOptionFliplines")}
                      checked={!!state.displaySettings.overlay?.flipLines}
                      onChange={() =>
                        handleAction("toggleOverlay", "flipLines")
                      }
                      disabled={overlaysDisabled}
                    />
                    <CheckboxMenuItem
                      icon={<FlippedPatternIcon ariaLabel="" />}
                      label={tHeader("overlayOptionFlippedPattern")}
                      checked={!!state.displaySettings.overlay?.flippedPattern}
                      onChange={() =>
                        handleAction("toggleOverlay", "flippedPattern")
                      }
                      disabled={overlaysDisabled}
                    />
                  </div>
                </DropdownMenu>

                {/* Line Weight Dropdown */}
                <DropdownMenu
                  closeOnSelect={true}
                  trigger={
                    <Tooltip description={tHeader("lineWeight")}>
                      <IconButton>
                        <LineWeightIcon ariaLabel={tHeader("lineWeight")} />
                      </IconButton>
                    </Tooltip>
                  }
                >
                  <div className="py-1 w-24">
                    {lineThicknessOptions.map((thickness) => (
                      <button
                        key={thickness}
                        onClick={() =>
                          handleAction("setLineThickness", thickness)
                        }
                        className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                          state.lineThickness === thickness
                            ? "bg-gray-100 dark:bg-gray-700 font-medium"
                            : ""
                        }`}
                      >
                        {thickness}px
                      </button>
                    ))}
                  </div>
                </DropdownMenu>
              </div>
            </section>

            {/* Pattern Controls - matches right menu group */}
            <section className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
              <SectionHeader>{t("patternControls")}</SectionHeader>
              <div className="flex flex-wrap items-center gap-1">
                <Tooltip description={tHeader("flipHorizontal")}>
                  <IconButton
                    onClick={() => handleAction("flipHorizontal")}
                    disabled={state.zoomedOut || state.magnifying}
                  >
                    <FlipVerticalIcon ariaLabel={tHeader("flipHorizontal")} />
                  </IconButton>
                </Tooltip>
                <Tooltip description={tHeader("flipVertical")}>
                  <IconButton
                    onClick={() => handleAction("flipVertical")}
                    disabled={state.zoomedOut || state.magnifying}
                  >
                    <FlipHorizontalIcon ariaLabel={tHeader("flipVertical")} />
                  </IconButton>
                </Tooltip>
                <Tooltip description={tHeader("rotate90")}>
                  <IconButton
                    onClick={() => handleAction("rotate")}
                    disabled={state.zoomedOut || state.magnifying}
                  >
                    <Rotate90DegreesCWIcon ariaLabel={tHeader("rotate90")} />
                  </IconButton>
                </Tooltip>
                <Tooltip description={tHeader("recenter")}>
                  <IconButton
                    onClick={() => handleAction("recenter")}
                    disabled={state.zoomedOut || state.magnifying}
                  >
                    <RecenterIcon ariaLabel={tHeader("recenter")} />
                  </IconButton>
                </Tooltip>
                <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />
                <Tooltip
                  description={
                    showProjectMovepad
                      ? tHeader("hideMovement")
                      : tHeader("showMovement")
                  }
                >
                  <IconButton
                    onClick={() => setShowProjectMovepad(!showProjectMovepad)}
                    active={showProjectMovepad}
                    disabled={state.zoomedOut || state.magnifying}
                  >
                    <MoveIcon ariaLabel={tHeader("showMovement")} />
                  </IconButton>
                </Tooltip>
                <Tooltip description={tHeader("magnify")}>
                  <IconButton
                    onClick={() => handleAction("toggleMagnify")}
                    active={state.magnifying}
                    disabled={state.zoomedOut}
                  >
                    <ZoomInIcon ariaLabel={tHeader("magnify")} />
                  </IconButton>
                </Tooltip>
                <Tooltip description={tHeader("zoomOut")}>
                  <IconButton
                    onClick={() => handleAction("toggleZoom")}
                    active={state.zoomedOut}
                    disabled={state.magnifying}
                  >
                    <ZoomOutIcon ariaLabel={tHeader("zoomOut")} />
                  </IconButton>
                </Tooltip>
                <Tooltip description={tHeader("measure")}>
                  <IconButton
                    onClick={() => handleAction("toggleMeasure")}
                    active={state.measuring}
                    disabled={state.magnifying}
                  >
                    <MarkAndMeasureIcon ariaLabel={tHeader("measure")} />
                  </IconButton>
                </Tooltip>
              </div>
              {/* Movement Pad for Panning/Rotating View */}
              {showProjectMovepad && (
                <div className="mt-4">
                  <MovementPadControl
                    mode="project"
                    corners={state.corners}
                    handleAction={handleAction}
                    t={tMove}
                  />
                </div>
              )}
            </section>

            {/* Mini Map for navigation */}
            <section className="bg-white dark:bg-gray-800 rounded-lg shadow">
              <button
                onClick={() => setPreviewExpanded(!previewExpanded)}
                className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-750 rounded-t-lg transition-colors"
              >
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  {t("preview")}
                </span>
                <svg
                  className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform ${previewExpanded ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              {previewExpanded && (
                <div className="px-4 pb-4">
                  <Preview
                    layoutWidth={state.layoutWidth}
                    layoutHeight={state.layoutHeight}
                    viewportBounds={state.viewportBounds}
                    calibrationBounds={state.calibrationBounds}
                    paperBounds={state.paperBounds}
                    previewImage={state.previewImage}
                    isPreviewLoading={state.isPreviewLoading}
                    showPreviewImage={state.showPreviewImage}
                    showBorder={!!state.displaySettings.overlay?.border}
                    showPaper={!!state.displaySettings.overlay?.paper}
                    theme={state.displaySettings.theme}
                    magnifying={state.magnifying}
                    isMagnified={state.isMagnified}
                    enlarged={previewEnlarged}
                    onNavigate={(x, y) =>
                      handleAction("navigateToPoint", { x, y })
                    }
                    onPanDelta={(dx, dy) =>
                      handleAction("panViewDelta", { dx, dy })
                    }
                    onMagnify={(x, y) =>
                      handleAction("magnifyAtPoint", { x, y })
                    }
                    onTogglePreview={() => handleAction("togglePreviewImage")}
                    onToggleSize={() => setPreviewEnlarged((e) => !e)}
                    t={t}
                  />
                </div>
              )}
            </section>

            {/* Stitch / Layers / Scale - grouped icon bar like main window */}
            <section className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
              <SectionHeader>{t("advancedOptions")}</SectionHeader>
              <div className="flex items-center gap-1 mb-3">
                {/* Stitch Icon - only for multi-page PDFs */}
                <Tooltip
                  description={
                    activePanel === "stitch"
                      ? tHeader("stitchMenuHide")
                      : hasFile && isPdf && state.pageCount > 1
                        ? tHeader("stitchMenuShow")
                        : tHeader("stitchMenuDisabled")
                  }
                >
                  <IconButton
                    active={activePanel === "stitch"}
                    disabled={!hasFile || !isPdf || state.pageCount <= 1}
                    onClick={() =>
                      setActivePanel(activePanel === "stitch" ? null : "stitch")
                    }
                  >
                    <FlexWrapIcon ariaLabel={tHeader("stitchMenuShow")} />
                  </IconButton>
                </Tooltip>

                {/* Layers Icon */}
                <Tooltip
                  description={
                    Object.keys(state.layers || {}).length > 0
                      ? activePanel === "layers"
                        ? tLayers("layersOff")
                        : tLayers("layersOn")
                      : tLayers("noLayers")
                  }
                >
                  <IconButton
                    active={activePanel === "layers"}
                    disabled={Object.keys(state.layers || {}).length === 0}
                    onClick={() =>
                      setActivePanel(activePanel === "layers" ? null : "layers")
                    }
                  >
                    <LayersIcon ariaLabel={tLayers("layersOn")} />
                  </IconButton>
                </Tooltip>

                {/* Scale Icon */}
                <Tooltip
                  description={
                    activePanel === "scale" ? tScale("hide") : tScale("show")
                  }
                >
                  <IconButton
                    active={activePanel === "scale"}
                    onClick={() =>
                      setActivePanel(activePanel === "scale" ? null : "scale")
                    }
                  >
                    <TuneIcon ariaLabel={tScale("show")} />
                  </IconButton>
                </Tooltip>
              </div>

              {/* Stitch Panel */}
              {activePanel === "stitch" &&
                hasFile &&
                isPdf &&
                state.pageCount > 1 && (
                  <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg flex flex-col items-start space-y-2">
                    <StepperInput
                      inputClassName="w-36"
                      handleChange={(e) =>
                        handleAction("setStitchPageRange", e.target.value)
                      }
                      label={tStitch("pageRange")}
                      name="page-range"
                      value={state.stitchSettings?.pageRange || ""}
                      onStep={(increment: number) =>
                        handleAction(
                          "setStitchPageRange",
                          rotateRange(
                            state.stitchSettings?.pageRange || "",
                            state.pageCount,
                            increment,
                          ),
                        )
                      }
                    />
                    <div className="flex gap-1">
                      <InlineSelect
                        handleChange={(e) =>
                          handleAction("setStitchLineDirection", e.target.value)
                        }
                        id="line-direction"
                        name="line-direction"
                        value={
                          state.stitchSettings?.lineDirection ||
                          LineDirection.Column
                        }
                        options={[
                          {
                            value: LineDirection.Column,
                            label: tStitch("columnCount"),
                          },
                          {
                            value: LineDirection.Row,
                            label: tStitch("rowCount"),
                          },
                        ]}
                      />
                      <StepperInput
                        inputClassName="w-12"
                        handleChange={(e) =>
                          handleAction("setStitchLineCount", e.target.value)
                        }
                        value={
                          state.stitchSettings?.lineCount === 0
                            ? ""
                            : String(state.stitchSettings?.lineCount || "")
                        }
                        onStep={(increment: number) =>
                          handleAction("stepStitchLineCount", increment)
                        }
                      />
                    </div>
                    <StepperInput
                      inputClassName="w-12"
                      handleChange={(e) =>
                        handleAction(
                          "setStitchEdgeInsetHorizontal",
                          e.target.value,
                        )
                      }
                      label={tStitch("horizontal")}
                      name="horizontal"
                      value={
                        state.stitchSettings?.edgeInsets?.horizontal === 0
                          ? ""
                          : String(
                              state.stitchSettings?.edgeInsets?.horizontal ||
                                "",
                            )
                      }
                      onStep={(increment: number) =>
                        handleAction("stepStitchHorizontal", increment)
                      }
                    />
                    <StepperInput
                      inputClassName="w-12"
                      handleChange={(e) =>
                        handleAction(
                          "setStitchEdgeInsetVertical",
                          e.target.value,
                        )
                      }
                      label={tStitch("vertical")}
                      name="vertical"
                      value={
                        state.stitchSettings?.edgeInsets?.vertical === 0
                          ? ""
                          : String(
                              state.stitchSettings?.edgeInsets?.vertical || "",
                            )
                      }
                      onStep={(increment: number) =>
                        handleAction("stepStitchVertical", increment)
                      }
                    />
                  </div>
                )}

              {/* Layers Panel */}
              {activePanel === "layers" &&
                Object.keys(state.layers || {}).length > 0 && (
                  <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <div className="flex justify-end mb-2">
                      <Button
                        onClick={() => handleAction("toggleAllLayers")}
                        className="text-xs px-2 py-1"
                      >
                        {Object.values(state.layers).some((l) => l.visible)
                          ? tLayers("hideAll")
                          : tLayers("showAll")}
                      </Button>
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {Object.entries(state.layers).map(([key, layer]) => (
                        <label
                          key={key}
                          className="flex items-center gap-2 py-1 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 rounded px-1"
                        >
                          <input
                            type="checkbox"
                            checked={layer.visible}
                            onChange={() => handleAction("toggleLayer", key)}
                            className="w-4 h-4 accent-purple-600 rounded"
                          />
                          <span className="text-sm">{layer.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

              {/* Scale Panel */}
              {activePanel === "scale" && (
                <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg flex flex-col items-start">
                  <StepperInput
                    inputClassName="w-20"
                    handleChange={(e) =>
                      handleAction("setScale", e.target.value)
                    }
                    label={tScale("scale")}
                    value={state.patternScale}
                    onStep={(delta) => handleAction("adjustScale", delta * 0.1)}
                    step={0.1}
                  />
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
