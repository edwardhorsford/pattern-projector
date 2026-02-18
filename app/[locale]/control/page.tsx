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
  secondaryColor,
  themePalette,
  strokeColor,
  themes,
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
import { Marker, MARKER_SIZE_INCHES } from "@/_lib/marker";
import { Line } from "@/_reducers/linesReducer";
import RotateToHorizontalIcon from "@/_icons/rotate-to-horizontal";
import ShiftIcon from "@/_icons/shift-icon";
import { LoadStatusEnum } from "@/_lib/load-status-enum";

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
  viewportBounds: ViewportBounds | null; // Current viewport in PDF coordinates
  calibrationBounds: CalibrationBounds | null; // Fixed calibration rectangle in PDF coordinates
  paperBounds: PaperBounds | null; // Paper sheet rectangle in PDF coordinates
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
  widthInput: "90",
  heightInput: "45",
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
      // Use half the marker size (2 inches = 144 points) as the click radius
      const clickRadius = 144; // 2 inches in PDF points (half of 4 inch marker)
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
            // Apply filter to container - Safari has issues with filter on transformed children
            filter:
              showPreviewImage && previewImage ? themeFilter(theme) : undefined,
            // Background: for inverted themes, set to white so it inverts to black
            // (filter inverts the background too)
            backgroundColor: isDarkTheme(theme) ? "#fff" : "#fff",
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
                position: "absolute" as const,
                top: "50%",
                left: "50%",
                // Image is the original PDF size (before transformation)
                width: layoutWidth * scale,
                height: layoutHeight * scale,
                // Apply the transform (rotation/flip)
                transform: `translate(-50%, -50%) matrix(${transformA}, ${transformC}, ${transformB}, ${transformD}, 0, 0)`,
                transformOrigin: "center center",
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
          // Convert marker position from PDF coordinates to preview coordinates
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
                filter: themeFilter(theme),
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
            <div className="w-4 h-0.5" style={{ backgroundColor: accentColor }} />
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
  const [devGridPreset, setDevGridPreset] = useState<"60x40" | "30x20">(
    "60x40",
  );
  const [memoryStats, setMemoryStats] = useState<HeapMemoryStats | null>(null);
  const [memoryAvailable, setMemoryAvailable] = useState(true);
  const [storageBytes, setStorageBytes] = useState(0);
  const [stateBytes, setStateBytes] = useState(0);
  const [debugMessages, setDebugMessages] = useState<string[]>([]);
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
      appendDebugMessage("Generating complex test data: A0 multi-page PDF");
      const { PDFDocument, StandardFonts, rgb } = await import(
        "@cantoo/pdf-lib"
      );

      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const pageSize = { width: 2384, height: 3370 };

      const addHeader = (
        page: {
          drawText: (text: string, options: Record<string, unknown>) => void;
        },
        title: string,
        subtitle: string,
      ) => {
        page.drawText(title, {
          x: 96,
          y: pageSize.height - 120,
          size: 44,
          font: boldFont,
          color: rgb(0, 0, 0),
        });

        page.drawText(subtitle, {
          x: 96,
          y: pageSize.height - 170,
          size: 24,
          font,
          color: rgb(0.4, 0.4, 0.4),
        });
      };

      const page1 = pdfDoc.addPage([pageSize.width, pageSize.height]);
      addHeader(
        page1,
        "Complex test pattern – A0 page 1",
        "Grey line darkness, anti-aliasing and curve stability",
      );

      const lineBlockTop = pageSize.height - 280;
      for (let row = 0; row < 48; row++) {
        const y = lineBlockTop - row * 38;
        const tone = Math.max(0.04, 0.85 - row * 0.016);
        const thickness = 0.2 + ((row % 8) + 1) * 0.15;
        page1.drawLine({
          start: { x: 140, y },
          end: { x: pageSize.width - 140, y },
          thickness,
          color: rgb(tone, tone, tone),
        });

        if (row % 6 === 0) {
          page1.drawText(`w=${thickness.toFixed(2)} g=${tone.toFixed(2)}`, {
            x: 96,
            y: y - 9,
            size: 16,
            font,
            color: rgb(0.25, 0.25, 0.25),
          });
        }
      }

      for (let curve = 0; curve < 14; curve++) {
        const y = 640 + curve * 95;
        const left = 180;
        const right = pageSize.width - 180;
        const controlRise = 110 + curve * 8;
        page1.drawLine({
          start: { x: left, y },
          end: { x: right, y: y + controlRise * 0.5 },
          thickness: 0.45 + (curve % 4) * 0.25,
          color: rgb(
            0.1 + curve * 0.045,
            0.1 + curve * 0.045,
            0.1 + curve * 0.045,
          ),
        });
        page1.drawEllipse({
          x: 230 + curve * 130,
          y: 430,
          xScale: 24 + curve * 2,
          yScale: 70,
          borderWidth: 0.8,
          borderColor: rgb(0, 0, 0),
        });
      }

      const page2 = pdfDoc.addPage([pageSize.width, pageSize.height]);
      addHeader(
        page2,
        "Complex test pattern – A0 page 2",
        "High-density grid, diagonals and text legibility",
      );

      for (let x = 150; x <= pageSize.width - 150; x += 16) {
        page2.drawLine({
          start: { x, y: 360 },
          end: { x, y: pageSize.height - 260 },
          thickness: x % 64 === 0 ? 0.75 : 0.24,
          color: rgb(0.58, 0.58, 0.58),
        });
      }

      for (let y = 360; y <= pageSize.height - 260; y += 16) {
        page2.drawLine({
          start: { x: 150, y },
          end: { x: pageSize.width - 150, y },
          thickness: y % 64 === 0 ? 0.75 : 0.24,
          color: rgb(0.58, 0.58, 0.58),
        });
      }

      page2.drawRectangle({
        x: 150,
        y: 360,
        width: pageSize.width - 300,
        height: pageSize.height - 620,
        borderWidth: 1.4,
        borderColor: rgb(0, 0, 0),
      });

      for (let diagonal = 0; diagonal < 24; diagonal++) {
        const startX = 150 + diagonal * 86;
        page2.drawLine({
          start: { x: startX, y: 360 },
          end: { x: startX + 560, y: pageSize.height - 260 },
          thickness: 0.2 + (diagonal % 5) * 0.15,
          color: rgb(0.33, 0.33, 0.33),
        });
      }

      const textSamples = [
        { size: 12, tone: 0.18, label: "12pt" },
        { size: 16, tone: 0.35, label: "16pt" },
        { size: 20, tone: 0.55, label: "20pt" },
        { size: 24, tone: 0, label: "24pt" },
      ];

      textSamples.forEach((sample, index) => {
        page2.drawText(
          `${sample.label}: Grainline • Notches • Cut on fold • Size M`,
          {
            x: 200,
            y: 250 - index * 42,
            size: sample.size,
            font,
            color: rgb(sample.tone, sample.tone, sample.tone),
          },
        );
      });

      const page3 = pdfDoc.addPage([pageSize.width, pageSize.height]);
      addHeader(
        page3,
        "Complex test pattern – A0 page 3",
        "Mixed line families and stitch-like geometry",
      );

      for (let stripe = 0; stripe < 36; stripe++) {
        const y = pageSize.height - 320 - stripe * 72;
        const tone = 0.08 + (stripe % 12) * 0.06;
        page3.drawLine({
          start: { x: 120, y },
          end: { x: pageSize.width - 120, y: y - ((stripe % 7) - 3) * 8 },
          thickness: 0.3 + (stripe % 9) * 0.22,
          color: rgb(tone, tone, tone),
        });
      }

      for (let ring = 0; ring < 18; ring++) {
        page3.drawEllipse({
          x: 400 + ring * 105,
          y: 700 + (ring % 3) * 80,
          xScale: 22 + ring * 4,
          yScale: 22 + ring * 1.8,
          borderWidth: 0.4 + (ring % 6) * 0.18,
          borderColor: rgb(0.12, 0.12, 0.12),
        });
      }

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
                    { value: "none", label: "none" },
                    { value: "moderate", label: "moderate" },
                    { value: "extreme", label: "extreme" },
                    { value: "custom", label: "custom" },
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
                  ]}
                  handleChange={(e) => {
                    const value = e.target.value as "60x40" | "30x20";
                    setDevGridPreset(value);
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
    </main>
  );
}
