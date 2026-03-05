"use client";

import { useCallback, useEffect, useState, useRef, ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import {
  useBroadcastChannel,
  BroadcastMessage,
} from "@/_hooks/use-broadcast-channel";
import { useKeyDown } from "@/_hooks/use-key-down";
import { KeyCode } from "@/_lib/key-code";
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
import MarkCompleteIcon from "@/_icons/mark-complete-icon";
import CheckIcon from "@/_icons/check-icon";
import AddBoxIcon from "@/_icons/add-box-icon";
import CloseIcon from "@/_icons/close-icon";
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
  isColourTheme,
  applyBrightness,
  secondaryColor,
  themePalette,
  strokeColor,
  themes,
  themeRecolourFilter,
  Theme,
} from "@/_lib/display-settings";
import { rotateRange } from "@/_lib/get-page-numbers";
import { Unit } from "@/_lib/unit";
import { Layers } from "@/_lib/layers";
import {
  StitchSettings,
  LineDirection,
} from "@/_lib/interfaces/stitch-settings";
import { Marker, MARKER_SIZE_INCHES } from "@/_lib/marker";
import { CSS_PIXELS_PER_INCH } from "@/_lib/pixels-per-inch";
import { Line } from "@/_reducers/linesReducer";
import RotateToHorizontalIcon from "@/_icons/rotate-to-horizontal";
import ShiftIcon from "@/_icons/shift-icon";
import { LoadStatusEnum } from "@/_lib/load-status-enum";
import Filters from "@/_components/filters";

// Default stitch settings for initial state
const defaultStitchSettings: StitchSettings = {
  key: "",
  pageRange: "",
  lineCount: 0,
  edgeInsets: { horizontal: 0, vertical: 0 },
  lineDirection: LineDirection.Column,
};

// Viewport bounds for mini map (in pattern space — pre-pan/zoom pattern coordinates)
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

// Calibration bounds for mini map border (in pattern space — pre-pan/zoom pattern coordinates)
interface CalibrationBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Paper bounds for mini map paper sheet overlay (in pattern space — pre-pan/zoom pattern coordinates)
// Uses same structure as CalibrationBounds
type PaperBounds = CalibrationBounds;

interface HeapMemoryStats {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface RenderMetrics {
  fileRenderDurationMs: number | null;
  fileRenderInProgressMs: number | null;
  thumbnailRenderDurationMs: number | null;
  thumbnailRenderInProgressMs: number | null;
}

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
  calibrationProfile: "none" | "moderate" | "extreme" | "custom";
  // Preview data
  previewImage: string | null; // Data URL of the PDF thumbnail
  isPreviewLoading: boolean; // Whether the preview is being generated
  previewSourceType: "pdf" | "svg" | "none";
  showPreviewImage: boolean; // Whether to show the PDF preview
  fileLoadStatus: number;
  lineThicknessStatus: number;
  renderMetrics: RenderMetrics;
  viewportBounds: ViewportBounds | null; // Current viewport in pattern space
  calibrationBounds: CalibrationBounds | null; // Fixed calibration rectangle in pattern space
  paperBounds: PaperBounds | null; // Paper sheet rectangle in pattern space
  layoutWidth: number;
  layoutHeight: number;
  // Markers for "mark complete" feature
  markers: Marker[];
  markingMode: boolean;
  clearingMode: boolean;
  // Lines for measure tool
  lines: Line[];
  selectedLine: number;
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
  widthInput: "60",
  heightInput: "40",
  unitOfMeasure: Unit.CM,
  layers: {},
  stitchSettings: defaultStitchSettings,
  showingMovePad: false,
  corners: [0],
  calibrationProfile: "none",
  // Preview defaults
  previewImage: null,
  isPreviewLoading: false,
  previewSourceType: "none",
  showPreviewImage: true,
  fileLoadStatus: 0,
  lineThicknessStatus: 0,
  renderMetrics: {
    fileRenderDurationMs: null,
    fileRenderInProgressMs: null,
    thumbnailRenderDurationMs: null,
    thumbnailRenderInProgressMs: null,
  },
  viewportBounds: null,
  calibrationBounds: null,
  paperBounds: null,
  layoutWidth: 0,
  layoutHeight: 0,
  // Marker defaults
  markers: [],
  markingMode: false,
  clearingMode: false,
  // Lines defaults
  lines: [],
  selectedLine: -1,
};

// Dropdown menu component with close callback and smart positioning
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
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Check if menu would overflow and adjust alignment
  useEffect(() => {
    if (isOpen && menuRef.current && ref.current) {
      const menuRect = menuRef.current.getBoundingClientRect();
      const triggerRect = ref.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;

      // Check if left-aligned menu would overflow right edge
      const leftAlignedRight = triggerRect.left + menuRect.width;
      // Check if right-aligned menu would overflow left edge
      const rightAlignedLeft = triggerRect.right - menuRect.width;

      if (leftAlignedRight > viewportWidth && rightAlignedLeft >= 0) {
        // Would overflow right, align to right instead
        setAlignRight(true);
      } else if (rightAlignedLeft < 0) {
        // Would overflow left, align to left
        setAlignRight(false);
      } else {
        // Default to left alignment
        setAlignRight(false);
      }
    }
  }, [isOpen]);

  const close = () => setIsOpen(false);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <div onClick={() => setIsOpen(!isOpen)}>{trigger}</div>
      {isOpen && (
        <div
          ref={menuRef}
          className={`absolute ${alignRight ? "right-0" : "left-0"} mt-1 bg-white dark:bg-gray-800 rounded-md shadow-lg z-50 border dark:border-gray-700`}
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
  markers,
  markingMode,
  clearingMode,
  onNavigate,
  onPanDelta,
  onPlaceMarker,
  onRemoveMarker,
  onMagnify,
  onHoverPoint,
  onZoomAtPoint,
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
  markers: Marker[];
  markingMode: boolean;
  clearingMode: boolean;
  onNavigate: (x: number, y: number) => void;
  onPanDelta: (dx: number, dy: number) => void;
  onPlaceMarker: (x: number, y: number) => void;
  onRemoveMarker: (markerId: string) => void;
  onMagnify: (x: number, y: number) => void;
  onHoverPoint: (point: { x: number; y: number } | null) => void;
  onZoomAtPoint: (delta: number, point: { x: number; y: number }) => void;
  onTogglePreview: () => void;
  onToggleSize: () => void;
  t: ReturnType<typeof useTranslations<"ControlPanel">>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [containerWidth, setContainerWidth] = useState(400);
  const accentColor = secondaryColor(theme);
  const softAccentColor = `${accentColor}26`;
  const lastNavigateTime = useRef(0);
  const handledMagnifyClick = useRef(false); // Track if we handled a magnify click
  const dragStartCoords = useRef<{ x: number; y: number } | null>(null); // Track drag start for delta calculation
  const lastDragCoords = useRef<{ x: number; y: number } | null>(null); // Track last drag position
  const throttleMs = 16; // Throttle navigation updates (~60fps)

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

  // Get the normalized transform matrix from viewport bounds
  // This represents the exact rotation + flip transformation
  const transformA = viewportBounds?.transformA ?? 1;
  const transformB = viewportBounds?.transformB ?? 0;
  const transformC = viewportBounds?.transformC ?? 0;
  const transformD = viewportBounds?.transformD ?? 1;

  // Calculate the bounding box of the transformed PDF
  // Transform the four corners of the original PDF and find the bounds
  const halfW = layoutWidth / 2;
  const halfH = layoutHeight / 2;
  const corners = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ];
  const transformedCorners = corners.map((c) => ({
    x: transformA * c.x + transformB * c.y,
    y: transformC * c.x + transformD * c.y,
  }));
  const minX = Math.min(...transformedCorners.map((c) => c.x));
  const maxX = Math.max(...transformedCorners.map((c) => c.x));
  const minY = Math.min(...transformedCorners.map((c) => c.y));
  const maxY = Math.max(...transformedCorners.map((c) => c.y));

  // The effective dimensions are the bounding box of the rotated/transformed PDF
  const effectiveLayoutWidth = maxX - minX;
  const effectiveLayoutHeight = maxY - minY;

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

  // Convert mini map screen coordinates to pattern space coordinates
  // Uses the inverse of the transform matrix to correctly handle any rotation + flip combination
  const screenToPdfCoords = (
    screenX: number,
    screenY: number,
  ): { x: number; y: number } => {
    // Get position relative to the PDF area center
    const centerX = scaledBufferX + (effectiveLayoutWidth * scale) / 2;
    const centerY = scaledBufferY + (effectiveLayoutHeight * scale) / 2;

    // Position relative to center, in pattern space units
    const relX = (screenX - centerX) / scale;
    const relY = (screenY - centerY) / scale;

    // Apply inverse of the transform matrix to get back to original pattern space coordinates
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

    // Convert back to pattern space coordinates (from center-relative)
    const pdfX = layoutWidth / 2 + pdfRelX;
    const pdfY = layoutHeight / 2 + pdfRelY;

    return { x: pdfX, y: pdfY };
  };

  const updateHoverPointFromPointerEvent = (
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!containerRef.current) {
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const hoverCoords = screenToPdfCoords(
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
    onHoverPoint(hoverCoords);
  };

  // Handle pointer events for click and drag
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;

    e.preventDefault();
    updateHoverPointFromPointerEvent(e);
    const rect = containerRef.current.getBoundingClientRect();
    const coords = screenToPdfCoords(
      e.clientX - rect.left,
      e.clientY - rect.top,
    );

    // If in marking mode, place a marker at this PDF position
    if (markingMode) {
      onPlaceMarker(coords.x, coords.y);
      return;
    }

    // If in clearing mode, check if we clicked near a marker
    if (clearingMode) {
      // Use half the marker size as the click radius (in pattern space: 96 CSS px/inch)
      const clickRadius = (MARKER_SIZE_INCHES / 2) * CSS_PIXELS_PER_INCH; // 2 inches = 192 px
      let closestMarker: Marker | null = null;
      let closestDistance = Infinity;

      for (const marker of markers) {
        const dx = marker.position.x - coords.x;
        const dy = marker.position.y - coords.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < clickRadius && distance < closestDistance) {
          closestDistance = distance;
          closestMarker = marker;
        }
      }

      if (closestMarker) {
        onRemoveMarker(closestMarker.id);
      }
      // Always auto-disable after a click (one-time action)
      // Note: This is handled by the callback that also calls toggleClearingMode
      return;
    }

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
    // Initial click: center on this point
    onNavigate(coords.x, coords.y);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    updateHoverPointFromPointerEvent(e);

    if (!isDragging || !lastDragCoords.current) return;

    // Throttle navigation updates to prevent glitchiness
    const now = Date.now();
    if (now - lastNavigateTime.current < throttleMs) return;
    lastNavigateTime.current = now;

    // Calculate delta in screen pixels from last position
    const screenDeltaX = e.clientX - lastDragCoords.current.x;
    const screenDeltaY = e.clientY - lastDragCoords.current.y;
    lastDragCoords.current = { x: e.clientX, y: e.clientY };

    // Convert screen delta to main window pixels
    // The preview is scaled down, so we need to scale up the delta
    // Moving right in preview = moving the view right = translating the pattern left
    // So we negate to get the expected behavior (drag pattern under the viewport)
    const mainWindowDeltaX = -screenDeltaX / scale;
    const mainWindowDeltaY = -screenDeltaY / scale;

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
  };

  const handlePointerLeave = () => {
    onHoverPoint(null);
  };

  const handlePointerEnter = (e: React.PointerEvent<HTMLDivElement>) => {
    updateHoverPointFromPointerEvent(e);
  };

  const handleWheelCapture = (event: React.WheelEvent<HTMLDivElement>) => {
    const modifierPressed =
      event.ctrlKey ||
      event.metaKey ||
      event.getModifierState("Control") ||
      event.getModifierState("Meta");

    if (!modifierPressed) {
      return;
    }

    event.preventDefault();

    const rect = event.currentTarget.getBoundingClientRect();
    const point = screenToPdfCoords(
      event.clientX - rect.left,
      event.clientY - rect.top,
    );

    const direction = Math.sign(event.deltaY);
    if (direction === 0) {
      return;
    }

    const steps = Math.max(1, Math.round(Math.abs(event.deltaY) / 80));
    const delta = -direction * 0.1 * steps;

    onHoverPoint(point);
    onZoomAtPoint(delta, point);
  };

  // Transform a point from pattern space coordinates to mini map display coordinates
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

    // Transform the four corners of the viewport bounds
    const corners = [
      pdfToDisplayCoords(viewportBounds.x, viewportBounds.y),
      pdfToDisplayCoords(
        viewportBounds.x + viewportBounds.width,
        viewportBounds.y,
      ),
      pdfToDisplayCoords(
        viewportBounds.x + viewportBounds.width,
        viewportBounds.y + viewportBounds.height,
      ),
      pdfToDisplayCoords(
        viewportBounds.x,
        viewportBounds.y + viewportBounds.height,
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
          // Inline cursor style based on mode
          cursor: clearingMode
            ? "cell"
            : markingMode
              ? "crosshair"
              : isMagnified
                ? "zoom-out"
                : magnifying
                  ? "zoom-in"
                  : isDragging
                    ? "grabbing"
                    : "crosshair",
        }}
        onPointerDown={handlePointerDown}
        onPointerEnter={handlePointerEnter}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onWheelCapture={handleWheelCapture}
      >
        {/* PDF area representation */}
        <div
          className="absolute border border-gray-400 dark:border-gray-500 overflow-hidden"
          style={{
            left: scaledBufferX,
            top: scaledBufferY,
            width: effectiveLayoutWidth * scale,
            height: effectiveLayoutHeight * scale,
            // Set background directly to match theme — no CSS filter needed
            // on the container, which avoids Safari filter-flickering bugs.
            backgroundColor: isDarkTheme(theme) ? "#000" : "#fff",
          }}
        >
          {/* Loading indicator */}
          {isPreviewLoading && showPreviewImage && (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{
                backgroundColor: isDarkTheme(theme)
                  ? "rgba(0, 0, 0, 0.5)"
                  : "rgba(255, 255, 255, 0.5)",
              }}
            >
              <div className="w-12 h-12 border-4 border-gray-300 dark:border-gray-600 border-t-purple-500 dark:border-t-purple-400 rounded-full animate-spin" />
            </div>
          )}
          {/* PDF thumbnail image */}
          {showPreviewImage && previewImage && (
            <img
              src={previewImage}
              alt=""
              className="pointer-events-none"
              style={{
                position: "absolute" as const,
                top: "50%",
                left: "50%",
                // Image is the original PDF size (before transformation)
                width: layoutWidth * scale,
                height: layoutHeight * scale,
                // Apply the transform (rotation/flip)
                transform: `translate(-50%, -50%) matrix(${transformA}, ${transformC}, ${transformB}, ${transformD}, 0, 0)`,
                transformOrigin: "center center",
                // Apply theme filter directly on the image rather than on
                // the container — avoids Safari dropping the filter during
                // React re-renders when state syncs.
                filter: themeRecolourFilter(theme),
              }}
              draggable={false}
            />
          )}
        </div>

        {/* Calibration border - shows the original calibration rectangle */}
        {showBorder && calibrationBorder && (
          <div
            className="absolute border-2 pointer-events-none"
            style={{
              left: calibrationBorder.x,
              top: calibrationBorder.y,
              width: Math.max(calibrationBorder.width, 4),
              height: Math.max(calibrationBorder.height, 4),
              borderColor: accentColor,
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
              border: `2px dashed ${accentColor}`,
            }}
          />
        )}

        {/* Markers - tick marks indicating completed sections (rendered before viewport so they appear below) */}
        {markers.map((marker) => {
          // Convert marker position from pattern space to preview coordinates
          // Need to apply the same transform as the preview image

          // Get position relative to PDF center
          const relX = marker.position.x - layoutWidth / 2;
          const relY = marker.position.y - layoutHeight / 2;

          // Apply the transform matrix to get rotated/flipped position
          const transformedX = transformA * relX + transformB * relY;
          const transformedY = transformC * relX + transformD * relY;

          // Convert to preview coordinates (relative to center of effective layout)
          const centerX = scaledBufferX + (effectiveLayoutWidth * scale) / 2;
          const centerY = scaledBufferY + (effectiveLayoutHeight * scale) / 2;

          const markerX = centerX + transformedX * scale;
          const markerY = centerY + transformedY * scale;

          // Marker size in preview pixels - use a larger minimum size so they're visible
          const markerSize = Math.max(MARKER_SIZE_INCHES * 72 * scale, 24); // At least 24px

          return (
            <div
              key={marker.id}
              className="absolute pointer-events-none"
              style={{
                left: markerX - markerSize / 2,
                top: markerY - markerSize / 2,
                width: markerSize,
                height: markerSize,
                // Apply theme filter to invert colors when in dark mode
                filter: themeRecolourFilter(theme),
              }}
            >
              <svg viewBox="0 0 100 100" width="100%" height="100%">
                {/* White background circle with border */}
                <circle
                  cx="50"
                  cy="50"
                  r="48"
                  fill="white"
                  stroke="white"
                  strokeWidth="4"
                />
                {/* Purple outer circle */}
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke={accentColor}
                  strokeWidth="8"
                />
                {/* Purple checkmark */}
                <path
                  d="M28 50 L44 66 L72 34"
                  fill="none"
                  stroke={accentColor}
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          );
        })}

        {/* Viewport indicator */}
        {viewport && (
          <div
            className="absolute border-2 pointer-events-none"
            style={{
              left: viewport.x,
              top: viewport.y,
              width: Math.max(viewport.width, 4),
              height: Math.max(viewport.height, 4),
              // No transform needed - viewport is already in rotated coordinates
              transformOrigin: "top left",
              borderColor: accentColor,
              backgroundColor: softAccentColor,
            }}
          />
        )}

        {/* Center crosshair when no viewport */}
        {!viewport && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              className="w-4 h-0.5"
              style={{ backgroundColor: accentColor }}
            />
            <div
              className="absolute w-0.5 h-4"
              style={{ backgroundColor: accentColor }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Movement pad constants - match main view (1/8 inch = 12 pixels at 96 DPI)
const BASE_PIXEL_SCALE = 12; // CSS_PIXELS_PER_INCH / 8
const PIXEL_LIST = [1, 2, 4]; // Multiplied by BASE_PIXEL_SCALE
const REPEAT_MS = 150; // Slightly slower than browser key repeat to match main window feel
const REPEAT_PX_COUNT = 4; // 4 * 150ms = 600ms to match main window acceleration timing

function formatBytes(value: number): string {
  const mb = value / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatMs(value: number | null): string {
  if (value === null) {
    return "-";
  }

  return `${Math.max(0, Math.round(value))} ms`;
}

function loadStatusToLabel(status: number): string {
  switch (status) {
    case LoadStatusEnum.LOADING:
      return "loading";
    case LoadStatusEnum.FAILED:
      return "failed";
    case LoadStatusEnum.SUCCESS:
      return "success";
    default:
      return "default";
  }
}

function getLocalStorageUsageBytes(): number {
  if (typeof window === "undefined") {
    return 0;
  }

  const encoder = new TextEncoder();
  let totalBytes = 0;

  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key === null) {
      continue;
    }
    const value = localStorage.getItem(key) ?? "";
    totalBytes += encoder.encode(key).length;
    totalBytes += encoder.encode(value).length;
  }

  return totalBytes;
}

function getApproxObjectBytes(value: unknown): number {
  const encoder = new TextEncoder();
  try {
    return encoder.encode(JSON.stringify(value)).length;
  } catch {
    return 0;
  }
}

// Movement pad for control panel - can be used for calibration (moving corners) or projecting (panning view)
function MovementPadControl({
  mode,
  corners,
  theme,
  handleAction,
  t,
}: {
  mode: "calibrate" | "project";
  corners: number[];
  theme: Theme;
  handleAction: (action: string, params?: unknown) => void;
  t: ReturnType<typeof useTranslations<"MovementPad">>;
}) {
  const [intervalFunc, setIntervalFunc] = useState<NodeJS.Timeout | null>(null);
  const border = "border-2";
  const borderColor = secondaryColor(theme);

  const handleStart = (direction: Direction) => {
    // First immediate move
    const initialPixels = PIXEL_LIST[0] * BASE_PIXEL_SCALE;
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
      const pixels =
        PIXEL_LIST[Math.floor(i / REPEAT_PX_COUNT)] * BASE_PIXEL_SCALE;
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
          style={{
            WebkitUserSelect: "none",
            userSelect: "none",
            borderColor,
          }}
          onPointerDown={() => handleStart(Direction.Up)}
          onPointerUp={handleStop}
          onPointerLeave={handleStop}
          className={`${border} col-start-2`}
        >
          <KeyboardArrowUpIcon ariaLabel={t("up")} />
        </IconButton>

        <IconButton
          style={{
            WebkitUserSelect: "none",
            userSelect: "none",
            borderColor,
          }}
          onPointerDown={() => handleStart(Direction.Left)}
          onPointerUp={handleStop}
          onPointerLeave={handleStop}
          className={`${border} col-start-1`}
        >
          <KeyboardArrowLeftIcon ariaLabel={t("left")} />
        </IconButton>

        <IconButton
          style={{
            WebkitUserSelect: "none",
            userSelect: "none",
            borderColor,
          }}
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
          style={{
            WebkitUserSelect: "none",
            userSelect: "none",
            borderColor,
          }}
          onPointerDown={() => handleStart(Direction.Right)}
          onPointerUp={handleStop}
          onPointerLeave={handleStop}
          className={`${border} col-start-3`}
        >
          <KeyboardArrowRightIcon ariaLabel={t("right")} />
        </IconButton>

        <IconButton
          style={{
            WebkitUserSelect: "none",
            userSelect: "none",
            borderColor,
          }}
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
  const isDevMode = process.env.NODE_ENV === "development";
  const t = useTranslations("ControlPanel");
  const tHeader = useTranslations("Header");
  const tStitch = useTranslations("StitchMenu");
  const tLayers = useTranslations("LayerMenu");
  const tScale = useTranslations("ScaleMenu");
  const tMove = useTranslations("MovementPad");
  const tLines = useTranslations("MeasureCanvas");
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
  const [showLinesPanel, setShowLinesPanel] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(true);
  const [previewEnlarged, setPreviewEnlarged] = useState(false); // Toggle between compact and large view
  const [devCalibrationPreset, setDevCalibrationPreset] = useState<
    "none" | "moderate" | "extreme" | "custom"
  >("none");
  const [devThemePreset, setDevThemePreset] = useState<Theme>(Theme.Light);
  const devGridPreset = (() => {
    const key = `${state.widthInput}x${state.heightInput}`;
    if (key === "60x40" || key === "30x20" || key === "15x10") {
      return key;
    }
    return "custom";
  })();
  const [memoryStats, setMemoryStats] = useState<HeapMemoryStats | null>(null);
  const [memoryAvailable, setMemoryAvailable] = useState(true);
  const [storageBytes, setStorageBytes] = useState(0);
  const [stateBytes, setStateBytes] = useState(0);
  const [debugMessages, setDebugMessages] = useState<string[]>([]);
  const [showHighResOverlay, setShowHighResOverlay] = useState(true);
  const [debugTintHighRes, setDebugTintHighRes] = useState(false);
  const [debugLowResBase, setDebugLowResBase] = useState(false);
  const controlKeyDownRef = useRef(false);
  const metaKeyDownRef = useRef(false);
  const gestureScaleRef = useRef(1);
  const previewHoverPointRef = useRef<{ x: number; y: number } | null>(null);
  const previewZoomSessionRef = useRef<{
    activeUntil: number;
    lockedPoint: { x: number; y: number } | null;
  }>({
    activeUntil: 0,
    lockedPoint: null,
  });

  const appendDebugMessage = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugMessages((prev) =>
      [`[${timestamp}] ${message}`, ...prev].slice(0, 50),
    );
  }, []);

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

  useEffect(() => {
    setDevCalibrationPreset(state.calibrationProfile);
  }, [state.calibrationProfile]);

  useEffect(() => {
    setDevThemePreset(state.displaySettings.theme);
  }, [state.displaySettings.theme]);

  useEffect(() => {
    if (
      (state as unknown as Record<string, unknown>).showHighResOverlay !==
      undefined
    )
      setShowHighResOverlay(
        (state as unknown as Record<string, unknown>)
          .showHighResOverlay as boolean,
      );
  }, [(state as unknown as Record<string, unknown>).showHighResOverlay]);

  useEffect(() => {
    if (
      (state as unknown as Record<string, unknown>).debugTintHighRes !==
      undefined
    )
      setDebugTintHighRes(
        (state as unknown as Record<string, unknown>)
          .debugTintHighRes as boolean,
      );
  }, [(state as unknown as Record<string, unknown>).debugTintHighRes]);

  useEffect(() => {
    if (
      (state as unknown as Record<string, unknown>).debugLowResBase !==
      undefined
    )
      setDebugLowResBase(
        (state as unknown as Record<string, unknown>)
          .debugLowResBase as boolean,
      );
  }, [(state as unknown as Record<string, unknown>).debugLowResBase]);

  useEffect(() => {
    if (!isDevMode) {
      return;
    }

    const updateMemoryStats = () => {
      const memory = (performance as Performance & { memory?: HeapMemoryStats })
        .memory;

      if (memory) {
        setMemoryStats(memory);
        setMemoryAvailable(true);
      } else {
        setMemoryStats(null);
        setMemoryAvailable(false);
      }

      setStorageBytes(getLocalStorageUsageBytes());
      setStateBytes(getApproxObjectBytes(state));
    };

    updateMemoryStats();
    const interval = setInterval(updateMemoryStats, 2000);

    return () => clearInterval(interval);
  }, [isDevMode, state]);

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

  // Keyboard shortcut X for "mark area complete" in control window
  useKeyDown(() => {
    // Only work when projecting (not calibrating), not zoomed out, and not magnifying
    if (!state.isCalibrating && !state.zoomedOut && !state.magnifying) {
      handleAction("markViewCenter");
    }
  }, [KeyCode.KeyX]);

  // Keyboard shortcut Escape to cancel any active tool
  useKeyDown(() => {
    handleAction("cancelAllTools");
  }, [KeyCode.Escape]);

  // Keyboard shortcut Cmd/Ctrl+Z for undo last marker placement
  useEffect(() => {
    const handleUndo = (e: KeyboardEvent) => {
      // Check for Cmd+Z (Mac) or Ctrl+Z (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        // Only undo markers when projecting (not calibrating), not in special modes
        if (
          !state.isCalibrating &&
          !state.zoomedOut &&
          !state.magnifying &&
          state.markers.length > 0
        ) {
          e.preventDefault();
          sendAction("undoMarker");
        }
      }
    };

    document.addEventListener("keydown", handleUndo);
    return () => document.removeEventListener("keydown", handleUndo);
  }, [
    state.isCalibrating,
    state.zoomedOut,
    state.magnifying,
    state.markers,
    sendAction,
  ]);

  // Arrow key handling for panning (project mode) or moving corners (calibrate mode)
  const [arrowKeyInterval, setArrowKeyInterval] =
    useState<NodeJS.Timeout | null>(null);
  const [activeArrowKey, setActiveArrowKey] = useState<string | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);

  useEffect(() => {
    const handleZoomShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) {
        return;
      }

      const isZoomIn =
        event.key === "+" || event.key === "=" || event.code === "NumpadAdd";
      const isZoomOut =
        event.key === "-" ||
        event.key === "_" ||
        event.code === "NumpadSubtract";
      const isReset = event.key === "0" || event.code === "Numpad0";

      if (isZoomIn || isZoomOut || isReset) {
        event.preventDefault();

        if (state.isCalibrating) {
          return;
        }

        if (isZoomIn) {
          sendAction("adjustScale", 0.1);
        } else if (isZoomOut) {
          sendAction("adjustScale", -0.1);
        } else {
          sendAction("resetScale");
        }
      }
    };

    const handlePinchZoom = (event: WheelEvent) => {
      const fromPreview = event
        .composedPath()
        .some(
          (node) =>
            node instanceof Element &&
            node.getAttribute("data-control-preview-map") === "true",
        );

      if (fromPreview) {
        return;
      }

      const controlPressed = event.ctrlKey || event.getModifierState("Control");
      const metaPressed = event.metaKey || event.getModifierState("Meta");
      const modifierPressed =
        controlPressed ||
        metaPressed ||
        controlKeyDownRef.current ||
        metaKeyDownRef.current;

      if (modifierPressed) {
        event.preventDefault();

        if (state.isCalibrating) {
          return;
        }

        const direction = Math.sign(event.deltaY);
        if (direction === 0) {
          return;
        }

        const steps = Math.max(1, Math.round(Math.abs(event.deltaY) / 80));
        const delta = -direction * 0.1 * steps;
        sendAction("adjustScale", delta);
      }
    };

    const handleGestureStart = (event: Event) => {
      event.preventDefault();

      const scale = (event as Event & { scale?: number }).scale;
      gestureScaleRef.current = scale ?? 1;
    };

    const handleGestureChange = (event: Event) => {
      event.preventDefault();

      if (state.isCalibrating) {
        return;
      }

      const scale = (event as Event & { scale?: number }).scale;
      if (scale === undefined) {
        return;
      }

      const diff = scale - gestureScaleRef.current;
      const threshold = 0.06;
      if (Math.abs(diff) < threshold) {
        return;
      }

      const steps = Math.trunc(Math.abs(diff) / threshold);
      gestureScaleRef.current = scale;

      if (steps === 0) {
        return;
      }

      const delta = (diff > 0 ? 0.1 : -0.1) * steps;
      sendAction("adjustScale", delta);
    };

    const handleGestureEnd = () => {
      gestureScaleRef.current = 1;
    };

    const handleModifierKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Control") {
        controlKeyDownRef.current = true;
      }
      if (event.key === "Meta") {
        metaKeyDownRef.current = true;
      }
    };

    const handleModifierKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Control") {
        controlKeyDownRef.current = false;
      }
      if (event.key === "Meta") {
        metaKeyDownRef.current = false;
      }
    };

    const handleWindowBlur = () => {
      controlKeyDownRef.current = false;
      metaKeyDownRef.current = false;
    };

    window.addEventListener("keydown", handleZoomShortcut);
    window.addEventListener("wheel", handlePinchZoom, {
      passive: false,
      capture: true,
    });
    window.addEventListener("gesturestart", handleGestureStart, {
      passive: false,
    });
    window.addEventListener("gesturechange", handleGestureChange, {
      passive: false,
    });
    window.addEventListener("gestureend", handleGestureEnd, { passive: false });
    window.addEventListener("keydown", handleModifierKeyDown);
    window.addEventListener("keyup", handleModifierKeyUp);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("keydown", handleZoomShortcut);
      window.removeEventListener("wheel", handlePinchZoom, true);
      window.removeEventListener("gesturestart", handleGestureStart);
      window.removeEventListener("gesturechange", handleGestureChange);
      window.removeEventListener("gestureend", handleGestureEnd);
      window.removeEventListener("keydown", handleModifierKeyDown);
      window.removeEventListener("keyup", handleModifierKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [sendAction, state.isCalibrating]);

  useEffect(() => {
    const keyToDirection = (key: string): Direction | null => {
      switch (key) {
        case "ArrowUp":
          return Direction.Up;
        case "ArrowDown":
          return Direction.Down;
        case "ArrowLeft":
          return Direction.Left;
        case "ArrowRight":
          return Direction.Right;
        default:
          return null;
      }
    };

    const getPixels = (baseMultiplier: number) => {
      const pixels = baseMultiplier * BASE_PIXEL_SCALE;
      return shiftHeld ? pixels * 10 : pixels;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        setShiftHeld(true);
        return;
      }

      // Don't handle arrow keys if focused on an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const direction = keyToDirection(e.key);
      if (direction && !activeArrowKey) {
        e.preventDefault();
        setActiveArrowKey(e.key);

        // First immediate move
        const initialPixels = getPixels(PIXEL_LIST[0]);
        if (state.isCalibrating) {
          sendAction("moveCorner", { direction, pixels: initialPixels });
        } else {
          sendAction("panView", { direction, pixels: initialPixels });
        }

        // Then repeated moves with acceleration
        let i = 0;
        const interval = setInterval(() => {
          if (i < PIXEL_LIST.length * REPEAT_PX_COUNT - 1) {
            ++i;
          }
          const pixels = getPixels(PIXEL_LIST[Math.floor(i / REPEAT_PX_COUNT)]);
          if (state.isCalibrating) {
            sendAction("moveCorner", { direction, pixels });
          } else {
            sendAction("panView", { direction, pixels });
          }
        }, REPEAT_MS);
        setArrowKeyInterval(interval);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        setShiftHeld(false);
        return;
      }

      if (e.key === activeArrowKey) {
        setActiveArrowKey(null);
        if (arrowKeyInterval) {
          clearInterval(arrowKeyInterval);
          setArrowKeyInterval(null);
        }
        // Save calibration context after move (only in calibrate mode)
        if (state.isCalibrating) {
          sendAction("saveCalibrationContext");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (arrowKeyInterval) {
        clearInterval(arrowKeyInterval);
      }
    };
  }, [
    activeArrowKey,
    arrowKeyInterval,
    state.isCalibrating,
    sendAction,
    shiftHeld,
  ]);

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

  const loadSimpleTestData = useCallback(async () => {
    try {
      appendDebugMessage("Loading simple test data: test-pattern.svg");
      const response = await fetch("/test-pattern.svg");
      if (!response.ok) {
        appendDebugMessage(
          `Failed to load test-pattern.svg (${response.status})`,
        );
        return;
      }

      const arrayBuffer = await response.arrayBuffer();
      sendFile("test-pattern.svg", "image/svg+xml", arrayBuffer);
      appendDebugMessage("Loaded simple test data");
    } catch {
      appendDebugMessage("Failed to load simple test data");
    }
  }, [appendDebugMessage, sendFile]);

  const loadComplexTestData = useCallback(async () => {
    try {
      appendDebugMessage("Generating complex test data: garment pattern PDF");
      const { PDFDocument, StandardFonts, rgb } = await import(
        "@cantoo/pdf-lib"
      );

      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const A0 = { width: 2384, height: 3370 };
      const black = rgb(0, 0, 0);
      const darkGrey = rgb(0.25, 0.25, 0.25);
      const midGrey = rgb(0.5, 0.5, 0.5);

      // Draw a double-headed grain line arrow (PDF coordinate space, y up)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const drawGrainLine = (
        page: any,
        x1: number,
        y1: number,
        x2: number,
        y2: number,
      ) => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        const ux = dx / len;
        const uy = dy / len;
        const nx = -uy;
        const ny = ux;
        const a = 32;
        const w = 12;
        page.drawLine({
          start: { x: x1, y: y1 },
          end: { x: x2, y: y2 },
          thickness: 1.5,
          color: black,
        });
        page.drawLine({
          start: { x: x2, y: y2 },
          end: { x: x2 - ux * a + nx * w, y: y2 - uy * a + ny * w },
          thickness: 1.5,
          color: black,
        });
        page.drawLine({
          start: { x: x2, y: y2 },
          end: { x: x2 - ux * a - nx * w, y: y2 - uy * a - ny * w },
          thickness: 1.5,
          color: black,
        });
        page.drawLine({
          start: { x: x1, y: y1 },
          end: { x: x1 + ux * a + nx * w, y: y1 + uy * a + ny * w },
          thickness: 1.5,
          color: black,
        });
        page.drawLine({
          start: { x: x1, y: y1 },
          end: { x: x1 + ux * a - nx * w, y: y1 + uy * a - ny * w },
          thickness: 1.5,
          color: black,
        });
      };

      // Draw a notch mark (perpendicular to seam direction) in PDF coordinate space
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const drawNotch = (
        page: any,
        x: number,
        y: number,
        seamAngle: number,
      ) => {
        const perpAngle = seamAngle + Math.PI / 2;
        const size = 28;
        page.drawLine({
          start: {
            x: x - Math.cos(perpAngle) * size,
            y: y - Math.sin(perpAngle) * size,
          },
          end: {
            x: x + Math.cos(perpAngle) * size,
            y: y + Math.sin(perpAngle) * size,
          },
          thickness: 2,
          color: black,
        });
      };

      // Helper: convert an SVG-space offset (sx, sy) to PDF absolute coordinates,
      // given a piece origin (ox, oy) in PDF space and a scale S.
      // drawSvgPath flips the y axis so SVG-down maps to PDF-up.
      const p = (
        ox: number,
        oy: number,
        S: number,
        sx: number,
        sy: number,
      ) => ({ x: ox + sx * S, y: oy - sy * S });

      // ===== PAGE 1: FRONT BODICE + BACK BODICE =====
      // drawSvgPath places the SVG origin at (x, y) in PDF space and flips the
      // y-axis, so SVG path coordinates use y-down (standard SVG convention).
      const page1 = pdfDoc.addPage([A0.width, A0.height]);

      page1.drawText("Linen Top – Sizes 10 / 12 / 14 / 16", {
        x: 96,
        y: A0.height - 110,
        size: 44,
        font: boldFont,
        color: black,
      });
      page1.drawText(
        "Page 1 of 3  ·  All seam allowances 1.5 cm  ·  Grain lines indicated by arrows",
        {
          x: 96,
          y: A0.height - 162,
          size: 24,
          font,
          color: midGrey,
        },
      );

      // Scale applied uniformly to bodice pieces so they fill the page height
      const S1 = 1.9;

      // Front bodice – right half, CF (centre front) on fold at left edge
      const fbX = 120;
      const fbY = 3160;

      // Cutting line: neckline curve, shoulder, armhole S-curve, side seam, waist
      page1.drawSvgPath(
        "M 0 30 C 80 6 210 0 290 0 L 470 92 C 530 165 560 295 565 440 C 568 530 555 615 525 680 L 470 1060 L 0 1040 Z",
        { x: fbX, y: fbY, scale: S1, borderColor: black, borderWidth: 2 },
      );
      // Stitching line (1.5 cm seam allowance, dashed)
      page1.drawSvgPath(
        "M 36 30 C 100 14 215 10 280 10 L 445 100 C 502 172 532 298 537 440 C 540 522 528 603 500 667 L 446 1023 L 36 1004 Z",
        {
          x: fbX,
          y: fbY,
          scale: S1,
          borderColor: midGrey,
          borderWidth: 1,
          borderDashArray: [12, 8],
        },
      );
      // CF fold line (dashed)
      page1.drawLine({
        start: p(fbX, fbY, S1, 0, 30),
        end: p(fbX, fbY, S1, 0, 1040),
        thickness: 1.5,
        color: black,
        dashArray: [20, 10],
      });
      // Size 10 size line
      page1.drawSvgPath(
        "M 0 30 C 78 8 205 3 282 3 L 452 97 C 512 169 541 298 546 440 C 549 528 537 611 508 675 L 453 1046 L 0 1028 Z",
        {
          x: fbX,
          y: fbY,
          scale: S1,
          borderColor: rgb(0.65, 0.65, 0.65),
          borderWidth: 0.8,
          borderDashArray: [6, 5],
        },
      );
      drawGrainLine(
        page1,
        ...(Object.values(p(fbX, fbY, S1, 240, 140)) as [number, number]),
        ...(Object.values(p(fbX, fbY, S1, 240, 900)) as [number, number]),
      );
      drawNotch(
        page1,
        p(fbX, fbY, S1, 520, 440).x,
        p(fbX, fbY, S1, 520, 440).y,
        0.15,
      );
      drawNotch(
        page1,
        p(fbX, fbY, S1, 555, 340).x,
        p(fbX, fbY, S1, 555, 340).y,
        0.4,
      );
      page1.drawText("FRONT BODICE", {
        ...p(fbX, fbY, S1, 62, 490),
        size: 32,
        font: boldFont,
        color: black,
      });
      page1.drawText("Cut 1 on fold", {
        ...p(fbX, fbY, S1, 62, 538),
        size: 22,
        font,
        color: darkGrey,
      });
      page1.drawText("Sizes 10–16", {
        ...p(fbX, fbY, S1, 62, 576),
        size: 20,
        font,
        color: darkGrey,
      });

      // Back bodice – right half, CB (centre back) on fold at left edge
      // Placed to the right of the front bodice (front bodice SVG width ~565, scaled ~1074)
      const bbX = fbX + Math.round(565 * S1) + 80;
      const bbY = fbY;

      page1.drawSvgPath(
        "M 0 0 L 248 26 L 438 100 C 498 172 528 296 533 440 C 535 530 522 612 494 678 L 440 1060 L 0 1040 Z",
        { x: bbX, y: bbY, scale: S1, borderColor: black, borderWidth: 2 },
      );
      page1.drawSvgPath(
        "M 36 12 L 240 38 L 418 109 C 475 179 504 298 508 440 C 510 522 498 600 472 664 L 418 1023 L 36 1004 Z",
        {
          x: bbX,
          y: bbY,
          scale: S1,
          borderColor: midGrey,
          borderWidth: 1,
          borderDashArray: [12, 8],
        },
      );
      // CB fold line
      page1.drawLine({
        start: p(bbX, bbY, S1, 0, 0),
        end: p(bbX, bbY, S1, 0, 1040),
        thickness: 1.5,
        color: black,
        dashArray: [20, 10],
      });
      drawGrainLine(
        page1,
        ...(Object.values(p(bbX, bbY, S1, 240, 140)) as [number, number]),
        ...(Object.values(p(bbX, bbY, S1, 240, 900)) as [number, number]),
      );
      drawNotch(
        page1,
        p(bbX, bbY, S1, 486, 440).x,
        p(bbX, bbY, S1, 486, 440).y,
        0.15,
      );
      drawNotch(
        page1,
        p(bbX, bbY, S1, 124, 13).x,
        p(bbX, bbY, S1, 124, 13).y,
        -0.8,
      );
      // Waist dart
      page1.drawLine({
        start: p(bbX, bbY, S1, 196, 700),
        end: p(bbX, bbY, S1, 238, 960),
        thickness: 1.5,
        color: black,
      });
      page1.drawLine({
        start: p(bbX, bbY, S1, 280, 700),
        end: p(bbX, bbY, S1, 238, 960),
        thickness: 1.5,
        color: black,
      });
      page1.drawLine({
        start: p(bbX, bbY, S1, 196, 700),
        end: p(bbX, bbY, S1, 280, 700),
        thickness: 1.5,
        color: black,
        dashArray: [5, 4],
      });
      page1.drawText("BACK BODICE", {
        ...p(bbX, bbY, S1, 62, 490),
        size: 32,
        font: boldFont,
        color: black,
      });
      page1.drawText("Cut 1 on fold", {
        ...p(bbX, bbY, S1, 62, 538),
        size: 22,
        font,
        color: darkGrey,
      });
      page1.drawText("Sizes 10–16", {
        ...p(bbX, bbY, S1, 62, 576),
        size: 20,
        font,
        color: darkGrey,
      });

      // Legend
      page1.drawLine({
        start: { x: 160, y: 180 },
        end: { x: 360, y: 180 },
        thickness: 2,
        color: black,
      });
      page1.drawText("Cutting line", {
        x: 376,
        y: 172,
        size: 20,
        font,
        color: black,
      });
      page1.drawLine({
        start: { x: 160, y: 140 },
        end: { x: 360, y: 140 },
        thickness: 1,
        color: midGrey,
        dashArray: [12, 8],
      });
      page1.drawText("Stitching line (1.5 cm seam allowance)", {
        x: 376,
        y: 132,
        size: 20,
        font,
        color: darkGrey,
      });

      // ===== PAGE 2: SLEEVE + SIDE PANEL =====
      const page2 = pdfDoc.addPage([A0.width, A0.height]);

      page2.drawText("Linen Top – Sleeve + Side Panel", {
        x: 96,
        y: A0.height - 110,
        size: 44,
        font: boldFont,
        color: black,
      });
      page2.drawText("Page 2 of 3  ·  All seam allowances 1.5 cm", {
        x: 96,
        y: A0.height - 162,
        size: 24,
        font,
        color: midGrey,
      });

      const S2 = 1.85;

      // Sleeve – left side of page, scaled to fill most of the page height
      const slX = 200;
      const slY = 3160;

      // Sleeve cap curves up (negative y in SVG = higher on page), tapers to wrist
      page2.drawSvgPath(
        "M 270 0 C 310 8 380 36 440 82 C 500 128 540 205 560 308 L 560 1450 L 0 1450 L 0 308 C 20 205 60 128 120 82 C 180 36 230 8 270 0 Z",
        { x: slX, y: slY, scale: S2, borderColor: black, borderWidth: 2 },
      );
      page2.drawSvgPath(
        "M 270 10 C 308 18 374 44 432 89 C 489 133 529 208 547 308 L 547 1413 L 13 1413 L 13 308 C 31 208 71 133 128 89 C 186 44 232 18 270 10 Z",
        {
          x: slX,
          y: slY,
          scale: S2,
          borderColor: midGrey,
          borderWidth: 1,
          borderDashArray: [12, 8],
        },
      );
      drawGrainLine(
        page2,
        ...(Object.values(p(slX, slY, S2, 280, 100)) as [number, number]),
        ...(Object.values(p(slX, slY, S2, 280, 1350)) as [number, number]),
      );
      // Single notch – front sleeve cap
      drawNotch(
        page2,
        p(slX, slY, S2, 444, 84).x,
        p(slX, slY, S2, 444, 84).y,
        -0.25,
      );
      // Double notch – back sleeve cap
      drawNotch(
        page2,
        p(slX, slY, S2, 116, 80).x,
        p(slX, slY, S2, 116, 80).y,
        -2.9,
      );
      drawNotch(
        page2,
        p(slX, slY, S2, 104, 56).x,
        p(slX, slY, S2, 104, 56).y,
        -2.9,
      );
      // Elbow line
      page2.drawLine({
        start: p(slX, slY, S2, 13, 780),
        end: p(slX, slY, S2, 547, 780),
        thickness: 1,
        color: midGrey,
        dashArray: [14, 8],
      });
      page2.drawText("ELBOW LINE", {
        ...p(slX, slY, S2, 568, 788),
        size: 18,
        font,
        color: midGrey,
      });
      page2.drawText("SLEEVE", {
        ...p(slX, slY, S2, 155, 660),
        size: 48,
        font: boldFont,
        color: black,
      });
      page2.drawText("Cut 2 – 1 pair", {
        ...p(slX, slY, S2, 155, 720),
        size: 24,
        font,
        color: darkGrey,
      });
      page2.drawText("Sizes 10–16", {
        ...p(slX, slY, S2, 155, 758),
        size: 22,
        font,
        color: darkGrey,
      });

      // Side panel – narrow tapered piece to the right of the sleeve
      // Sleeve SVG width is 560, so scaled right edge = slX + 560*S2
      const spX = slX + Math.round(560 * S2) + 100;
      const spY = slY;

      page2.drawSvgPath("M 0 0 L 320 0 L 340 900 L -20 900 Z", {
        x: spX,
        y: spY,
        scale: S2,
        borderColor: black,
        borderWidth: 2,
      });
      page2.drawSvgPath("M 36 36 L 284 36 L 303 864 L 17 864 Z", {
        x: spX,
        y: spY,
        scale: S2,
        borderColor: midGrey,
        borderWidth: 1,
        borderDashArray: [12, 8],
      });
      drawGrainLine(
        page2,
        ...(Object.values(p(spX, spY, S2, 160, 80)) as [number, number]),
        ...(Object.values(p(spX, spY, S2, 160, 820)) as [number, number]),
      );
      drawNotch(
        page2,
        p(spX, spY, S2, 0, 380).x,
        p(spX, spY, S2, 0, 380).y,
        -Math.PI / 2,
      );
      drawNotch(
        page2,
        p(spX, spY, S2, 320, 380).x,
        p(spX, spY, S2, 320, 380).y,
        Math.PI / 2,
      );
      page2.drawText("SIDE PANEL", {
        ...p(spX, spY, S2, 28, 440),
        size: 26,
        font: boldFont,
        color: black,
      });
      page2.drawText("Cut 2 pairs", {
        ...p(spX, spY, S2, 28, 478),
        size: 20,
        font,
        color: darkGrey,
      });

      // ===== PAGE 3: SKIRT FRONT + SKIRT BACK + WAISTBAND =====
      const page3 = pdfDoc.addPage([A0.width, A0.height]);

      page3.drawText("Linen Top – Skirt Pieces", {
        x: 96,
        y: A0.height - 110,
        size: 44,
        font: boldFont,
        color: black,
      });
      page3.drawText(
        "Page 3 of 3  ·  All seam allowances 1.5 cm  ·  Hem allowance 3 cm",
        {
          x: 96,
          y: A0.height - 162,
          size: 24,
          font,
          color: midGrey,
        },
      );

      // Skirt pieces are tall (SVG height 1640), scale 1.6 fills most of the page
      const S3 = 1.6;

      // Skirt front – right half on fold, slightly flared A-line shape
      const sfX = 120;
      const sfY = 3150;

      page3.drawSvgPath(
        "M 0 0 C 180 -22 420 -28 600 -12 L 660 1640 L 0 1640 Z",
        { x: sfX, y: sfY, scale: S3, borderColor: black, borderWidth: 2 },
      );
      page3.drawSvgPath(
        "M 36 8 C 196 -14 412 -19 565 -4 L 623 1604 L 36 1604 Z",
        {
          x: sfX,
          y: sfY,
          scale: S3,
          borderColor: midGrey,
          borderWidth: 1,
          borderDashArray: [12, 8],
        },
      );
      // CF fold line
      page3.drawLine({
        start: p(sfX, sfY, S3, 0, 0),
        end: p(sfX, sfY, S3, 0, 1640),
        thickness: 1.5,
        color: black,
        dashArray: [20, 10],
      });
      drawGrainLine(
        page3,
        ...(Object.values(p(sfX, sfY, S3, 320, 200)) as [number, number]),
        ...(Object.values(p(sfX, sfY, S3, 320, 1450)) as [number, number]),
      );
      drawNotch(
        page3,
        p(sfX, sfY, S3, 460, -14).x,
        p(sfX, sfY, S3, 460, -14).y,
        0.05,
      );
      // Hem fold line
      page3.drawLine({
        start: p(sfX, sfY, S3, 0, 1553),
        end: p(sfX, sfY, S3, 634, 1553),
        thickness: 1.2,
        color: midGrey,
        dashArray: [10, 6],
      });
      page3.drawText("HEM FOLD LINE", {
        ...p(sfX, sfY, S3, 80, 1590),
        size: 18,
        font,
        color: midGrey,
      });
      page3.drawText("SKIRT FRONT", {
        ...p(sfX, sfY, S3, 80, 780),
        size: 36,
        font: boldFont,
        color: black,
      });
      page3.drawText("Cut 1 on fold", {
        ...p(sfX, sfY, S3, 80, 828),
        size: 24,
        font,
        color: darkGrey,
      });
      page3.drawText("Sizes 10–16", {
        ...p(sfX, sfY, S3, 80, 866),
        size: 22,
        font,
        color: darkGrey,
      });

      // Skirt back – right half on fold with waist dart
      // Skirt front SVG width is 660, so scaled right edge = sfX + 660*S3
      const sbX = sfX + Math.round(660 * S3) + 80;
      const sbY = sfY;

      page3.drawSvgPath(
        "M 0 0 C 180 -22 430 -28 620 -12 L 680 1640 L 0 1640 Z",
        { x: sbX, y: sbY, scale: S3, borderColor: black, borderWidth: 2 },
      );
      page3.drawSvgPath(
        "M 36 8 C 196 -14 418 -20 582 -4 L 642 1604 L 36 1604 Z",
        {
          x: sbX,
          y: sbY,
          scale: S3,
          borderColor: midGrey,
          borderWidth: 1,
          borderDashArray: [12, 8],
        },
      );
      // CB fold line
      page3.drawLine({
        start: p(sbX, sbY, S3, 0, 0),
        end: p(sbX, sbY, S3, 0, 1640),
        thickness: 1.5,
        color: black,
        dashArray: [20, 10],
      });
      drawGrainLine(
        page3,
        ...(Object.values(p(sbX, sbY, S3, 320, 200)) as [number, number]),
        ...(Object.values(p(sbX, sbY, S3, 320, 1450)) as [number, number]),
      );
      drawNotch(
        page3,
        p(sbX, sbY, S3, 480, -14).x,
        p(sbX, sbY, S3, 480, -14).y,
        0.05,
      );
      // Waist dart
      page3.drawLine({
        start: p(sbX, sbY, S3, 200, 10),
        end: p(sbX, sbY, S3, 238, 240),
        thickness: 1.5,
        color: black,
      });
      page3.drawLine({
        start: p(sbX, sbY, S3, 276, 10),
        end: p(sbX, sbY, S3, 238, 240),
        thickness: 1.5,
        color: black,
      });
      page3.drawLine({
        start: p(sbX, sbY, S3, 200, 10),
        end: p(sbX, sbY, S3, 276, 10),
        thickness: 1.5,
        color: black,
        dashArray: [5, 4],
      });
      // Hem fold line
      page3.drawLine({
        start: p(sbX, sbY, S3, 0, 1553),
        end: p(sbX, sbY, S3, 650, 1553),
        thickness: 1.2,
        color: midGrey,
        dashArray: [10, 6],
      });
      page3.drawText("HEM FOLD LINE", {
        ...p(sbX, sbY, S3, 80, 1590),
        size: 18,
        font,
        color: midGrey,
      });
      page3.drawText("SKIRT BACK", {
        ...p(sbX, sbY, S3, 80, 780),
        size: 36,
        font: boldFont,
        color: black,
      });
      page3.drawText("Cut 1 on fold", {
        ...p(sbX, sbY, S3, 80, 828),
        size: 24,
        font,
        color: darkGrey,
      });
      page3.drawText("Sizes 10–16", {
        ...p(sbX, sbY, S3, 80, 866),
        size: 22,
        font,
        color: darkGrey,
      });

      // Waistband – a folded strip at the bottom of the page
      // Bottom of skirt pieces: sfY - 1640*S3 ≈ 526. Waistband sits just below.
      const wbX = 120;
      const wbY = 160;
      const wbW = A0.width - 240;
      const wbH = 280;

      page3.drawRectangle({
        x: wbX,
        y: wbY,
        width: wbW,
        height: wbH,
        borderWidth: 2,
        borderColor: black,
      });
      page3.drawRectangle({
        x: wbX + 36,
        y: wbY + 36,
        width: wbW - 72,
        height: wbH - 72,
        borderWidth: 1,
        borderColor: midGrey,
        borderDashArray: [12, 8],
      });
      // Centre fold line
      page3.drawLine({
        start: { x: wbX + wbW / 2, y: wbY },
        end: { x: wbX + wbW / 2, y: wbY + wbH },
        thickness: 1,
        color: midGrey,
        dashArray: [10, 6],
      });
      page3.drawText("WAISTBAND", {
        x: wbX + 60,
        y: wbY + wbH - 72,
        size: 30,
        font: boldFont,
        color: black,
      });
      page3.drawText("Cut 1 – fold along centre line", {
        x: wbX + 60,
        y: wbY + wbH - 118,
        size: 20,
        font,
        color: darkGrey,
      });
      drawGrainLine(
        page3,
        wbX + wbW - 420,
        wbY + wbH / 2,
        wbX + wbW - 120,
        wbY + wbH / 2,
      );

      const bytes = await pdfDoc.save();
      const pdfBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      sendFile("test-pattern-multipage.pdf", "application/pdf", pdfBuffer);
      appendDebugMessage("Loaded complex test data (A0 3-page PDF)");
    } catch {
      appendDebugMessage("Failed to generate complex test data");
    }
  }, [appendDebugMessage, sendFile]);

  const isConnected =
    state.connected && lastSync && Date.now() - lastSync < 5000;
  const hasFile = state.file !== null;
  const isPdf = state.file?.type === "application/pdf";
  const isProjecting = !state.isCalibrating;
  const isDark = isDarkTheme(state.displaySettings.theme);
  const controlAccentColor = secondaryColor(state.displaySettings.theme);
  const controlActiveBg = `${controlAccentColor}33`;
  const selectedThemePalette = themePalette(devThemePreset);
  const overlaysDisabled = state.displaySettings.overlay?.disabled;

  const lineThicknessOptions = [0, 1, 2, 3, 4];

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
              color={ButtonColor.SECONDARY}
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
                    { value: Unit.CM, label: "cm" },
                    { value: Unit.IN, label: "in" },
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
                    theme={state.displaySettings.theme}
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
                {/* Lines toggle button - show as active when there are lines */}
                <Tooltip
                  description={
                    showLinesPanel
                      ? tLines("lines")
                      : state.lines.length > 0
                        ? `${tLines("lines")} (${state.lines.length})`
                        : tLines("lines")
                  }
                >
                  <IconButton
                    onClick={() => setShowLinesPanel(!showLinesPanel)}
                    active={showLinesPanel || state.lines.length > 0}
                    disabled={state.magnifying || state.zoomedOut}
                  >
                    <MarkAndMeasureIcon ariaLabel={tLines("lines")} />
                  </IconButton>
                </Tooltip>
                <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />
                {/* Markers dropdown menu */}
                <DropdownMenu
                  trigger={
                    <Tooltip description={t("markComplete")}>
                      <IconButton
                        active={state.markingMode || state.clearingMode}
                        disabled={state.magnifying || state.zoomedOut}
                      >
                        <MarkCompleteIcon ariaLabel={t("markComplete")} />
                      </IconButton>
                    </Tooltip>
                  }
                >
                  {(close) => (
                    <div className="py-1 min-w-[200px]">
                      <button
                        onClick={() => {
                          handleAction("markViewCenter");
                          close();
                        }}
                        disabled={state.magnifying || state.zoomedOut}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-left disabled:opacity-50"
                      >
                        <CheckIcon ariaLabel="" />
                        <span>{t("markAreaComplete")}</span>
                      </button>
                      <button
                        onClick={() => {
                          handleAction("toggleMarkingMode");
                          close();
                        }}
                        disabled={state.magnifying || state.zoomedOut}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-left disabled:opacity-50"
                        style={
                          state.markingMode
                            ? { backgroundColor: controlActiveBg }
                            : undefined
                        }
                      >
                        <AddBoxIcon ariaLabel="" />
                        <span>
                          {state.markingMode
                            ? t("placeMarkerActive")
                            : t("placeMarker")}
                        </span>
                      </button>
                      <button
                        onClick={() => {
                          handleAction("toggleClearingMode");
                          close();
                        }}
                        disabled={state.markers.length === 0}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-left disabled:opacity-50"
                        style={
                          state.clearingMode
                            ? { backgroundColor: controlActiveBg }
                            : undefined
                        }
                      >
                        <CloseIcon ariaLabel="" />
                        <span>
                          {state.clearingMode
                            ? t("clearMarkerActive")
                            : t("clearMarker")}
                        </span>
                      </button>
                      <div className="border-t dark:border-gray-700 my-1" />
                      <button
                        onClick={() => {
                          handleAction("clearMarkers");
                          close();
                        }}
                        disabled={state.markers.length === 0}
                        className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-left disabled:opacity-50"
                      >
                        <DeleteIcon ariaLabel="" />
                        <span>{t("clearMarkers")}</span>
                      </button>
                    </div>
                  )}
                </DropdownMenu>
              </div>
              {/* Movement Pad for Panning/Rotating View */}
              {showProjectMovepad && (
                <div className="mt-4">
                  <MovementPadControl
                    mode="project"
                    corners={state.corners}
                    theme={state.displaySettings.theme}
                    handleAction={handleAction}
                    t={tMove}
                  />
                </div>
              )}
              {/* Lines Panel for measure tool */}
              {showLinesPanel && (
                <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                    {state.lines.length === 1
                      ? `1 ${tLines("line")}`
                      : `${state.lines.length} ${tLines("lines")}`}
                  </div>
                  {state.lines.length === 0 ? (
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {tHeader("measure")}
                      </span>
                      <button
                        onClick={() => handleAction("toggleMeasure")}
                        className="w-8 h-8 flex items-center justify-center text-lg font-medium rounded text-white"
                        style={{ backgroundColor: controlAccentColor }}
                      >
                        +
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Line selector */}
                      <div className="flex items-center gap-2 flex-wrap mb-3">
                        {state.lines.map((line, i) => (
                          <button
                            key={i}
                            onClick={() => handleAction("selectLine", i)}
                            className={`w-8 h-8 flex items-center justify-center text-sm font-medium rounded ${
                              i === state.selectedLine
                                ? "text-white"
                                : "bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500"
                            }`}
                            style={
                              i === state.selectedLine
                                ? { backgroundColor: controlAccentColor }
                                : undefined
                            }
                          >
                            {i + 1}
                          </button>
                        ))}
                        {/* Add new line button */}
                        <button
                          onClick={() => handleAction("toggleMeasure")}
                          className={`w-8 h-8 flex items-center justify-center text-lg font-medium rounded ${
                            state.measuring
                              ? "text-white"
                              : "bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500"
                          }`}
                          style={
                            state.measuring
                              ? { backgroundColor: controlAccentColor }
                              : undefined
                          }
                        >
                          +
                        </button>
                      </div>
                      {/* Selected line info */}
                      {state.selectedLine >= 0 &&
                        state.lines[state.selectedLine] && (
                          <div className="mb-3 text-sm">
                            <span className="font-medium">
                              {parseFloat(
                                state.lines[state.selectedLine].distance,
                              ).toFixed(1)}
                              {state.lines[
                                state.selectedLine
                              ].unitOfMeasure.toLowerCase()}
                            </span>
                            <span className="ml-2 text-gray-500 dark:text-gray-400">
                              {state.lines[state.selectedLine].angle}°
                            </span>
                          </div>
                        )}
                      {/* Line actions */}
                      <div className="flex gap-2 flex-wrap">
                        <Tooltip description={tLines("deleteLine")}>
                          <IconButton
                            border={true}
                            onClick={() => handleAction("deleteLine")}
                            disabled={state.selectedLine < 0}
                          >
                            <DeleteIcon ariaLabel={tLines("deleteLine")} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip description={tLines("rotateToHorizontal")}>
                          <IconButton
                            border={true}
                            onClick={() =>
                              handleAction("rotateLineToHorizontal")
                            }
                            disabled={state.selectedLine < 0}
                          >
                            <RotateToHorizontalIcon
                              ariaLabel={tLines("rotateToHorizontal")}
                            />
                          </IconButton>
                        </Tooltip>
                        <Tooltip
                          description={tLines("rotateAndCenterPrevious")}
                        >
                          <IconButton
                            border={true}
                            onClick={() =>
                              handleAction("rotateAndCenterPrevious")
                            }
                            disabled={state.lines.length === 0}
                          >
                            <KeyboardArrowLeftIcon
                              ariaLabel={tLines("rotateAndCenterPrevious")}
                            />
                          </IconButton>
                        </Tooltip>
                        <Tooltip description={tLines("rotateAndCenterNext")}>
                          <IconButton
                            border={true}
                            onClick={() => handleAction("rotateAndCenterNext")}
                            disabled={state.lines.length === 0}
                          >
                            <KeyboardArrowRightIcon
                              ariaLabel={tLines("rotateAndCenterNext")}
                            />
                          </IconButton>
                        </Tooltip>
                        <Tooltip description={tLines("flipAlong")}>
                          <IconButton
                            border={true}
                            onClick={() => handleAction("flipAlongLine")}
                            disabled={state.selectedLine < 0}
                          >
                            <FlipHorizontalIcon
                              ariaLabel={tLines("flipAlong")}
                            />
                          </IconButton>
                        </Tooltip>
                        <Tooltip description={tLines("translate")}>
                          <IconButton
                            border={true}
                            onClick={() => handleAction("translateAlongLine")}
                            disabled={state.selectedLine < 0}
                          >
                            <ShiftIcon ariaLabel={tLines("translate")} />
                          </IconButton>
                        </Tooltip>
                      </div>
                    </>
                  )}
                </div>
              )}
            </section>

            {/* Mini Map for navigation */}
            <section className="bg-white dark:bg-gray-800 rounded-lg shadow">
              <button
                onClick={() => setPreviewExpanded(!previewExpanded)}
                className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700 rounded-t-lg transition-colors"
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
                    markers={state.markers}
                    markingMode={state.markingMode}
                    clearingMode={state.clearingMode}
                    onNavigate={(x, y) =>
                      handleAction("navigateToPoint", { x, y })
                    }
                    onPanDelta={(dx, dy) =>
                      handleAction("panViewDelta", { dx, dy })
                    }
                    onPlaceMarker={(x, y) => {
                      handleAction("addMarker", { x, y });
                      handleAction("toggleMarkingMode"); // Auto-disable after placing
                    }}
                    onRemoveMarker={(markerId) => {
                      handleAction("removeMarker", markerId);
                      handleAction("toggleClearingMode"); // Auto-disable after removing
                    }}
                    onMagnify={(x, y) =>
                      handleAction("magnifyAtPoint", { x, y })
                    }
                    onHoverPoint={(point) => {
                      previewHoverPointRef.current = point;
                      if (point === null) {
                        previewZoomSessionRef.current = {
                          activeUntil: 0,
                          lockedPoint: null,
                        };
                      }
                    }}
                    onZoomAtPoint={(delta, point) => {
                      const now = Date.now();
                      const { activeUntil, lockedPoint } =
                        previewZoomSessionRef.current;

                      const sessionExpired = now > activeUntil;
                      const sessionPoint = sessionExpired
                        ? point
                        : lockedPoint ?? point;

                      if (sessionExpired) {
                        handleAction("navigateToPoint", {
                          x: sessionPoint.x,
                          y: sessionPoint.y,
                        });
                      }

                      handleAction("adjustScale", delta);

                      previewZoomSessionRef.current = {
                        activeUntil: now + 320,
                        lockedPoint: sessionPoint,
                      };
                    }}
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
                <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <div className="flex justify-end mb-2">
                    <Button
                      onClick={() => handleAction("resetScale")}
                      className="text-xs px-2 py-1"
                    >
                      {tScale("reset")}
                    </Button>
                  </div>
                  <StepperInput
                    inputClassName="w-20"
                    handleChange={(e) =>
                      handleAction("setScale", e.target.value)
                    }
                    label={tScale("scale")}
                    value={state.patternScale}
                    onStep={(delta) => handleAction("adjustScale", delta)}
                    step={0.1}
                  />
                </div>
              )}
            </section>
          </div>
        )}

        {isDevMode && (
          <section className="mt-4 bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
            <SectionHeader>Dev tools</SectionHeader>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  if (
                    window.confirm("Clear app data and reset current state?")
                  ) {
                    appendDebugMessage("Requested app data reset");
                    handleAction("clearAppData");
                  }
                }}
                className="text-xs px-3 py-1"
              >
                Clear app data
              </Button>

              <Button
                onClick={() => {
                  appendDebugMessage("Cleared image cache, forcing re-render");
                  handleAction("clearImageCache");
                }}
                className="text-xs px-3 py-1"
              >
                Clear image cache
              </Button>

              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showHighResOverlay}
                  onChange={(e) => {
                    setShowHighResOverlay(e.target.checked);
                    handleAction("setShowHighResOverlay", e.target.checked);
                  }}
                  className="accent-purple-600"
                />
                High-res overlay
              </label>

              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={debugTintHighRes}
                  onChange={(e) => {
                    setDebugTintHighRes(e.target.checked);
                    handleAction("setDebugTintHighRes", e.target.checked);
                  }}
                  className="accent-purple-600"
                />
                Debug: tint overlay amber
              </label>

              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={debugLowResBase}
                  onChange={(e) => {
                    setDebugLowResBase(e.target.checked);
                    handleAction("setDebugLowResBase", e.target.checked);
                  }}
                  className="accent-purple-600"
                />
                Debug: low-res base render
              </label>

              <div className="flex flex-wrap items-center gap-2 rounded border dark:border-gray-700 px-2 py-1 w-full">
                <label
                  htmlFor="dev-brightness"
                  className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap w-28"
                >
                  Brightness:{" "}
                  <span className="font-mono">
                    {(() => {
                      const val =
                        (state.displaySettings.brightness ?? 1.0) - 1.0;
                      const sign = val >= 0 ? "+" : "";
                      return `${sign}${Math.round(val * 100)}%`;
                    })()}
                  </span>
                </label>
                <input
                  id="dev-brightness"
                  type="range"
                  min={0.5}
                  max={1.5}
                  step={0.05}
                  list="brightness-ticks"
                  value={state.displaySettings.brightness ?? 1.0}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value);
                    handleAction("setBrightness", value);
                  }}
                  className="flex-1 accent-purple-600"
                />
                <datalist id="brightness-ticks">
                  <option value="1.0" />
                </datalist>
                <button
                  type="button"
                  onClick={() => handleAction("setBrightness", 1.0)}
                  className="text-xs text-purple-600 dark:text-purple-400 hover:underline"
                >
                  Reset
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded border dark:border-gray-700 px-2 py-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Theme preset
                </span>
                <InlineSelect
                  id="dev-theme-preset"
                  name="dev-theme-preset"
                  value={devThemePreset}
                  options={themes().map((themeOption) => ({
                    value: themeOption,
                    label: themeOption,
                  }))}
                  handleChange={(e) => {
                    const preset = e.target.value as Theme;
                    setDevThemePreset(preset);
                    appendDebugMessage(`Applied theme preset ${preset}`);
                    handleAction("setTheme", preset);
                  }}
                />
                <div className="flex items-center gap-1">
                  <span
                    className="w-3 h-3 rounded-sm border border-gray-500"
                    title="Primary"
                    style={{ backgroundColor: selectedThemePalette.primary }}
                  />
                  <span
                    className="w-3 h-3 rounded-sm border border-gray-500"
                    title="Secondary"
                    style={{ backgroundColor: selectedThemePalette.secondary }}
                  />
                  <span
                    className="w-3 h-3 rounded-sm border border-gray-500"
                    title="Tertiary"
                    style={{ backgroundColor: selectedThemePalette.tertiary }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded border dark:border-gray-700 px-2 py-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Calibration profile
                </span>
                <InlineSelect
                  id="dev-calibration-preset"
                  name="dev-calibration-preset"
                  value={devCalibrationPreset}
                  options={[
                    { value: "none", label: "None" },
                    { value: "moderate", label: "Moderate" },
                    { value: "extreme", label: "Extreme" },
                    { value: "custom", label: "Custom" },
                  ]}
                  handleChange={(e) => {
                    const preset = e.target.value as
                      | "none"
                      | "moderate"
                      | "extreme"
                      | "custom";
                    setDevCalibrationPreset(preset);

                    if (preset === "custom") {
                      appendDebugMessage(
                        "Custom calibration detected (manual or unmatched points)",
                      );
                      return;
                    }

                    appendDebugMessage(`Applied ${preset} calibration preset`);
                    handleAction("applyCalibrationPreset", preset);
                  }}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded border dark:border-gray-700 px-2 py-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Grid size
                </span>
                <InlineSelect
                  id="dev-grid-preset"
                  name="dev-grid-preset"
                  value={devGridPreset}
                  options={[
                    { value: "60x40", label: "60×40" },
                    { value: "30x20", label: "30×20" },
                    { value: "15x10", label: "15×10" },
                    ...(devGridPreset === "custom"
                      ? [{ value: "custom", label: "Custom" }]
                      : []),
                  ]}
                  handleChange={(e) => {
                    const value = e.target.value as "60x40" | "30x20" | "15x10";
                    const [presetWidth, presetHeight] = value.split("x");
                    appendDebugMessage(
                      `Applied calibration size preset ${presetWidth}×${presetHeight}`,
                    );
                    handleAction("setCalibrationSizePreset", {
                      width: presetWidth,
                      height: presetHeight,
                    });
                  }}
                />
              </div>

              <Button
                onClick={() => {
                  void loadSimpleTestData();
                }}
                className="text-xs px-3 py-1"
              >
                Load test data: simple
              </Button>

              <Button
                onClick={() => {
                  void loadComplexTestData();
                }}
                className="text-xs px-3 py-1"
              >
                Load test data: complex PDF
              </Button>

              <Button
                onClick={() => setDebugMessages([])}
                className="text-xs px-3 py-1"
              >
                Clear debug log
              </Button>
            </div>

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300">
              <div>Mode: {state.isCalibrating ? "calibrate" : "project"}</div>
              <div>Connected: {isConnected ? "yes" : "no"}</div>
              <div>
                File:{" "}
                {state.file
                  ? `${state.file.name} (${state.file.type})`
                  : "none"}
              </div>
              <div>
                Last sync:{" "}
                {lastSync
                  ? `${Math.max(0, Date.now() - lastSync)} ms ago`
                  : "none"}
              </div>
            </div>

            <div className="mt-3 rounded border dark:border-gray-700 p-3 text-xs">
              <div className="font-semibold mb-1">Memory usage</div>
              {memoryAvailable && memoryStats ? (
                <div className="space-y-1 text-gray-600 dark:text-gray-300">
                  <div>
                    Used heap: {formatBytes(memoryStats.usedJSHeapSize)}
                  </div>
                  <div>
                    Total heap: {formatBytes(memoryStats.totalJSHeapSize)}
                  </div>
                  <div>
                    Heap limit: {formatBytes(memoryStats.jsHeapSizeLimit)}
                  </div>
                </div>
              ) : (
                <div className="space-y-1 text-gray-600 dark:text-gray-300">
                  <div className="text-gray-500 dark:text-gray-400">
                    Heap API unavailable in this browser
                  </div>
                  <div>Approx synced state size: {formatBytes(stateBytes)}</div>
                  <div>Local storage usage: {formatBytes(storageBytes)}</div>
                </div>
              )}
            </div>

            <div className="mt-3 rounded border dark:border-gray-700 p-3 text-xs">
              <div className="font-semibold mb-1">Render performance</div>
              <div className="space-y-1 text-gray-600 dark:text-gray-300">
                <div>
                  Preview source: {state.previewSourceType.toUpperCase()}
                </div>
                <div>
                  File load status: {loadStatusToLabel(state.fileLoadStatus)}
                </div>
                <div>
                  Line thickness status:{" "}
                  {loadStatusToLabel(state.lineThicknessStatus)}
                </div>
                <div>
                  File render (last):{" "}
                  {formatMs(state.renderMetrics.fileRenderDurationMs)}
                </div>
                <div>
                  File render (in progress):{" "}
                  {formatMs(state.renderMetrics.fileRenderInProgressMs)}
                </div>
                <div>
                  Thumbnail render (last):{" "}
                  {formatMs(state.renderMetrics.thumbnailRenderDurationMs)}
                </div>
                <div>
                  Thumbnail render (in progress):{" "}
                  {formatMs(state.renderMetrics.thumbnailRenderInProgressMs)}
                </div>
              </div>
            </div>

            <div className="mt-3 rounded border dark:border-gray-700 p-3 text-xs">
              <div className="font-semibold mb-1">Debug messages</div>
              <div className="max-h-36 overflow-y-auto font-mono text-gray-600 dark:text-gray-300 space-y-1">
                {debugMessages.length === 0 ? (
                  <div className="text-gray-500 dark:text-gray-400">
                    No debug messages yet
                  </div>
                ) : (
                  debugMessages.map((message, index) => (
                    <div key={`${message}-${index}`}>{message}</div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}
      </div>
      <Filters
        recolourHex={
          isColourTheme(state.displaySettings.theme)
            ? applyBrightness(
                strokeColor(state.displaySettings.theme),
                state.displaySettings.brightness ?? 1.0,
              )
            : undefined
        }
      />
    </main>
  );
}
