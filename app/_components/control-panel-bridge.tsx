"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  useBroadcastChannel,
  BroadcastMessage,
  ActionPayload,
  FileTransferPayload,
} from "@/_hooks/use-broadcast-channel";
import {
  useTransformerContext,
  useTransformContext,
} from "@/_hooks/use-transform-context";
import { DisplaySettings, themes } from "@/_lib/display-settings";
import {
  MenuStates,
  SideMenuType,
  toggleSideMenuStates,
} from "@/_lib/menu-states";
import { Dispatch, SetStateAction, ChangeEvent, RefObject } from "react";
import { PatternScaleAction } from "@/_reducers/patternScaleReducer";
import { Layers } from "@/_lib/layers";
import Matrix from "ml-matrix";
import {
  StitchSettings,
  LineDirection,
} from "@/_lib/interfaces/stitch-settings";
import { StitchSettingsAction } from "@/_reducers/stitchSettingsReducer";
import { LayerAction } from "@/_reducers/layersReducer";
import { getCalibrationContext } from "@/_lib/calibration-context";
import { PointAction } from "@/_reducers/pointsReducer";
import { Direction } from "@/_lib/direction";
import { Point } from "@/_lib/point";
import {
  transformPoint,
  rectCorners,
  getBounds,
  RestoreTransforms,
  translate,
  scaleAboutPoint,
} from "@/_lib/geometry";
import { inverse } from "ml-matrix";
import { getPtDensity, CM } from "@/_lib/unit";

interface ControlPanelBridgeProps {
  // State to sync
  isCalibrating: boolean;
  setIsCalibrating: (value: boolean) => void;
  displaySettings: DisplaySettings;
  setDisplaySettings: (settings: DisplaySettings) => void;
  zoomedOut: boolean;
  setZoomedOut: (value: boolean) => void;
  magnifying: boolean;
  setMagnifying: (value: boolean) => void;
  measuring: boolean;
  setMeasuring: (value: boolean) => void;
  file: File | null;
  setFile: (file: File | null) => void;
  lineThickness: number;
  setLineThickness: (value: number) => void;
  pageCount: number;
  patternScale: string;
  dispatchPatternScaleAction: Dispatch<PatternScaleAction>;
  menuStates: MenuStates;
  setMenuStates: Dispatch<SetStateAction<MenuStates>>;
  // Calibration settings
  widthInput: string;
  heightInput: string;
  handleWidthChange: (e: ChangeEvent<HTMLInputElement>) => void;
  handleHeightChange: (e: ChangeEvent<HTMLInputElement>) => void;
  unitOfMeasure: string;
  setUnitOfMeasure: (unit: string) => void;
  handleResetCalibration: () => void;
  // For file input (no longer needed but kept for compatibility)
  fileInputRef: RefObject<HTMLInputElement>;
  // For actions
  width: number;
  height: number;
  layoutWidth: number;
  layoutHeight: number;
  getCalibrationCenterPoint: (
    width: number,
    height: number,
    unitOfMeasure: string,
  ) => { x: number; y: number };
  // Layers
  layers: Layers;
  dispatchLayerAction: Dispatch<LayerAction>;
  // Stitch settings
  stitchSettings: StitchSettings;
  dispatchStitchSettings: Dispatch<StitchSettingsAction>;
  // Move pad
  showingMovePad: boolean;
  setShowingMovePad: (value: boolean) => void;
  // Calibration corners and dispatch for movement
  corners: Set<number>;
  setCorners: (corners: Set<number>) => void;
  dispatchPoints: (action: PointAction) => void;
  // Calibration validation
  setCalibrationValidated: (value: boolean) => void;
  fullScreenActive: boolean;
  // For preview viewport calculation
  perspective: Matrix;
  // Calibration transform for saving restore state
  calibrationTransform: Matrix;
  // Saved transforms when zoomed out or magnifying (to preserve rotation/flip state)
  restoreTransforms: RestoreTransforms | null;
  setRestoreTransforms: (value: RestoreTransforms | null) => void;
  // PDF thumbnail for preview
  pdfThumbnail: string | null;
  isPreviewLoading: boolean;
  showPreviewImage: boolean;
  setShowPreviewImage: (value: boolean) => void;
}

/**
 * Bridge component that handles communication between the main calibrate page
 * and the control panel window via BroadcastChannel.
 * This component must be rendered inside a Transformable context.
 */
export function ControlPanelBridge({
  isCalibrating,
  setIsCalibrating,
  displaySettings,
  setDisplaySettings,
  zoomedOut,
  setZoomedOut,
  magnifying,
  setMagnifying,
  measuring,
  setMeasuring,
  file,
  setFile,
  lineThickness,
  setLineThickness,
  pageCount,
  patternScale,
  dispatchPatternScaleAction,
  menuStates,
  setMenuStates,
  widthInput,
  heightInput,
  handleWidthChange,
  handleHeightChange,
  unitOfMeasure,
  setUnitOfMeasure,
  handleResetCalibration,
  fileInputRef,
  width,
  height,
  layoutWidth,
  layoutHeight,
  getCalibrationCenterPoint,
  layers,
  dispatchLayerAction,
  stitchSettings,
  dispatchStitchSettings,
  showingMovePad,
  setShowingMovePad,
  corners,
  setCorners,
  dispatchPoints,
  setCalibrationValidated,
  fullScreenActive,
  perspective,
  calibrationTransform,
  restoreTransforms,
  setRestoreTransforms,
  pdfThumbnail,
  isPreviewLoading,
  showPreviewImage,
  setShowPreviewImage,
}: ControlPanelBridgeProps) {
  const transformer = useTransformerContext();
  const localTransform = useTransformContext();
  const syncRequestedRef = useRef(false);

  // When zoomed out or magnifying, use the saved transform for preview display
  // This preserves the rotation/flip state in the preview even though the actual
  // localTransform is reset to identity during zoom out
  const effectiveTransform =
    (zoomedOut || magnifying) && restoreTransforms
      ? restoreTransforms.localTransform
      : localTransform;

  // Helper function to get offset from direction
  function getOffset(direction: Direction, px: number): Point {
    switch (direction) {
      case Direction.Up:
        return { y: -px, x: 0 };
      case Direction.Down:
        return { y: px, x: 0 };
      case Direction.Left:
        return { y: 0, x: -px };
      case Direction.Right:
        return { y: 0, x: px };
      default:
        return { x: 0, y: 0 };
    }
  }

  // Calculate viewport bounds in PDF coordinates for mini map
  const calculateViewportBounds = useCallback(() => {
    if (layoutWidth === 0 || layoutHeight === 0) {
      return null;
    }

    // Get screen corners (browser window dimensions)
    const screenWidth = typeof window !== "undefined" ? window.innerWidth : 0;
    const screenHeight = typeof window !== "undefined" ? window.innerHeight : 0;
    const screenCorners = rectCorners(screenWidth, screenHeight);

    // Transform screen corners to PDF coordinates using inverse of combined transform
    // Combined transform: perspective (calibration inverse) + localTransform
    // Use the ACTUAL current localTransform for position calculation (not effectiveTransform)
    // This ensures the viewport shows the real current view position, even during zoom out
    try {
      const inverseLocal = inverse(localTransform);
      const pdfCorners = screenCorners.map((p) => {
        // First apply perspective (to get to calibrated space)
        const calibrated = transformPoint(p, perspective);
        // Then apply inverse local transform (to get to PDF space)
        return transformPoint(calibrated, inverseLocal);
      });

      // Get bounding box
      const [min, max] = getBounds(pdfCorners);

      // For rotation/flip display, use effectiveTransform which preserves the saved state during zoom out
      // This keeps the mini map image orientation correct even when localTransform is identity
      const m = effectiveTransform.to1DArray();

      // Detect flip state from the transform matrix
      // The determinant of the 2x2 scale/rotation part indicates if there's a flip
      // det = m[0]*m[4] - m[1]*m[3] = scaleX * scaleY
      // Negative determinant means one axis is flipped (odd number of flips)
      const det = m[0] * m[4] - m[1] * m[3];
      const hasFlip = det < 0;

      // Extract the 2x2 rotation/scale part of the matrix for the mini map
      // This allows us to apply the exact same transform to the mini map image
      // Normalize by the scale to get just rotation + flip
      const scaleXMag = Math.sqrt(m[0] * m[0] + m[1] * m[1]);
      const scaleYMag = Math.sqrt(m[3] * m[3] + m[4] * m[4]);

      // Normalized matrix components (just rotation + flip, no scale)
      const a = scaleXMag > 0 ? m[0] / scaleXMag : 1;
      const b = scaleYMag > 0 ? m[1] / scaleYMag : 0;
      const c = scaleXMag > 0 ? m[3] / scaleXMag : 0;
      const d = scaleYMag > 0 ? m[4] / scaleYMag : 1;

      // Standard rotation calculation for reference
      const rotation = Math.atan2(m[3], m[0]) * (180 / Math.PI);

      return {
        x: min.x,
        y: min.y,
        width: max.x - min.x,
        height: max.y - min.y,
        rotation,
        // Pass the normalized transform matrix components for accurate mini map rendering
        transformA: a,
        transformB: b,
        transformC: c,
        transformD: d,
        hasFlip,
      };
    } catch {
      return null;
    }
  }, [
    layoutWidth,
    layoutHeight,
    perspective,
    localTransform,
    effectiveTransform,
  ]);

  // Calculate calibration bounds in PDF coordinates for mini map border
  // This represents the fixed calibration rectangle (what the projector can display) in PDF space
  // The size is fixed (width x height in calibration units), but position changes with pan/rotate
  const calculateCalibrationBounds = useCallback(() => {
    if (width === 0 || height === 0) {
      return null;
    }

    // Calculate calibration size in PDF units (points)
    const ptDensity = getPtDensity(unitOfMeasure);
    const calWidth = width * ptDensity;
    const calHeight = height * ptDensity;

    // The calibration area in "calibration space" is (0,0) to (calWidth, calHeight)
    // Transform corners to PDF space using inverse of localTransform
    // This properly handles rotation and flipping
    try {
      const inverseLocal = inverse(localTransform);

      // Transform the 4 corners of the calibration rectangle
      const corners = [
        transformPoint({ x: 0, y: 0 }, inverseLocal),
        transformPoint({ x: calWidth, y: 0 }, inverseLocal),
        transformPoint({ x: calWidth, y: calHeight }, inverseLocal),
        transformPoint({ x: 0, y: calHeight }, inverseLocal),
      ];

      // Get bounding box in PDF space
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);

      return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      };
    } catch {
      return null;
    }
  }, [width, height, unitOfMeasure, localTransform]);

  // Calculate paper sheet bounds in PDF coordinates for mini map
  // Paper sheet is centered in the calibration area, sized for A4 (CM) or Letter (IN)
  const calculatePaperBounds = useCallback(() => {
    if (width === 0 || height === 0) {
      return null;
    }

    // Paper dimensions based on unit of measure (matching drawing.ts drawPaperSheet)
    const [paperWidth, paperHeight] =
      unitOfMeasure === CM ? [29.7, 21] : [11, 8.5];

    // Calculate calibration size in the current unit
    const calWidth = width;
    const calHeight = height;

    // Paper is centered in calibration area (in calibration units)
    const paperX = (calWidth - paperWidth) * 0.5;
    const paperY = (calHeight - paperHeight) * 0.5;

    // Convert to PDF units (points)
    const ptDensity = getPtDensity(unitOfMeasure);
    const paperWidthPts = paperWidth * ptDensity;
    const paperHeightPts = paperHeight * ptDensity;
    const paperXPts = paperX * ptDensity;
    const paperYPts = paperY * ptDensity;

    // Transform corners to PDF space using inverse of localTransform
    // This properly handles rotation and flipping
    try {
      const inverseLocal = inverse(localTransform);

      // Transform the 4 corners of the paper rectangle
      const corners = [
        transformPoint({ x: paperXPts, y: paperYPts }, inverseLocal),
        transformPoint(
          { x: paperXPts + paperWidthPts, y: paperYPts },
          inverseLocal,
        ),
        transformPoint(
          { x: paperXPts + paperWidthPts, y: paperYPts + paperHeightPts },
          inverseLocal,
        ),
        transformPoint(
          { x: paperXPts, y: paperYPts + paperHeightPts },
          inverseLocal,
        ),
      ];

      // Get bounding box in PDF space
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);

      return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      };
    } catch {
      return null;
    }
  }, [width, height, unitOfMeasure, localTransform]);

  // Build current state object
  const buildState = useCallback(
    () => ({
      isCalibrating,
      displaySettings,
      zoomedOut,
      magnifying,
      // Whether we're actively zoomed in (magnify mode + already magnified)
      isMagnified: magnifying && restoreTransforms !== null,
      measuring,
      file: file ? { name: file.name, type: file.type } : null,
      lineThickness,
      pageCount,
      patternScale,
      menuStates: {
        layers: menuStates.layers,
        stitch: menuStates.stitch,
        scale: menuStates.scale,
      },
      widthInput,
      heightInput,
      unitOfMeasure,
      layers,
      stitchSettings,
      showingMovePad,
      corners: Array.from(corners),
      // Preview data
      previewImage: pdfThumbnail,
      isPreviewLoading,
      showPreviewImage,
      viewportBounds: calculateViewportBounds(),
      calibrationBounds: calculateCalibrationBounds(),
      paperBounds: calculatePaperBounds(),
      layoutWidth,
      layoutHeight,
    }),
    [
      isCalibrating,
      displaySettings,
      zoomedOut,
      magnifying,
      restoreTransforms,
      measuring,
      file,
      lineThickness,
      pageCount,
      patternScale,
      menuStates,
      widthInput,
      heightInput,
      unitOfMeasure,
      layers,
      stitchSettings,
      showingMovePad,
      corners,
      pdfThumbnail,
      isPreviewLoading,
      showPreviewImage,
      calculateViewportBounds,
      calculateCalibrationBounds,
      calculatePaperBounds,
      layoutWidth,
      layoutHeight,
    ],
  );

  // Handle incoming messages from control panel
  const handleMessage = useCallback(
    (message: BroadcastMessage) => {
      if (message.type === "request-sync") {
        // Control panel is requesting current state - flag it for immediate sync
        syncRequestedRef.current = true;
      } else if (message.type === "file-transfer") {
        // Control panel is sending a file
        const { name, type, data } = message.payload as FileTransferPayload;
        const newFile = new File([data], name, { type });
        setFile(newFile);
        // Also switch to project mode when a file is opened
        setIsCalibrating(false);
      } else if (message.type === "action") {
        const { action, params } = message.payload as ActionPayload;
        const center = getCalibrationCenterPoint(width, height, unitOfMeasure);

        switch (action) {
          case "toggleMode":
            setIsCalibrating(!isCalibrating);
            break;
          case "saveAndProject":
            // Save calibration context and switch to project mode (like main window's button)
            const current = getCalibrationContext(fullScreenActive);
            localStorage.setItem("calibrationContext", JSON.stringify(current));
            setCalibrationValidated(true);
            setIsCalibrating(false);
            // If no file is loaded, trigger file open
            if (file === null && fileInputRef.current !== null) {
              fileInputRef.current.click();
            }
            break;
          case "flipHorizontal":
            transformer.flipHorizontal(center);
            break;
          case "flipVertical":
            transformer.flipVertical(center);
            break;
          case "rotate":
            transformer.rotate(center, 90);
            break;
          case "recenter":
            transformer.recenter(center, layoutWidth, layoutHeight);
            break;
          case "toggleTheme":
            const currentIdx = themes().indexOf(displaySettings.theme);
            const theme = themes()[(currentIdx + 1) % themes().length];
            setDisplaySettings({
              ...displaySettings,
              theme,
            });
            break;
          case "toggleOverlay":
            const overlayKey = params as keyof DisplaySettings["overlay"];
            setDisplaySettings({
              ...displaySettings,
              overlay: {
                ...displaySettings.overlay,
                [overlayKey]: !displaySettings.overlay[overlayKey],
              },
            });
            break;
          case "toggleZoom":
            setZoomedOut(!zoomedOut);
            break;
          case "toggleMagnify":
            setMagnifying(!magnifying);
            break;
          case "toggleMeasure":
            setMeasuring(!measuring);
            break;
          case "setLineThickness":
            setLineThickness(params as number);
            break;
          case "adjustScale":
            const delta = params as number;
            const currentScale = Number(patternScale);
            const newScale = Math.max(0.5, Math.min(2, currentScale + delta));
            dispatchPatternScaleAction({
              type: "set",
              scale: newScale.toFixed(2),
            });
            break;
          case "setScale":
            dispatchPatternScaleAction({
              type: "set",
              scale: params as string,
            });
            break;
          case "toggleMenu":
            const menuType = params as string;
            if (menuType === "stitch") {
              setMenuStates(
                toggleSideMenuStates(menuStates, SideMenuType.stitch),
              );
            } else if (menuType === "layers") {
              setMenuStates(
                toggleSideMenuStates(menuStates, SideMenuType.layers),
              );
            } else if (menuType === "scale") {
              setMenuStates(
                toggleSideMenuStates(menuStates, SideMenuType.scale),
              );
            }
            break;
          case "setWidth":
            // Create a synthetic event for the handler
            handleWidthChange({
              target: { value: params as string },
            } as ChangeEvent<HTMLInputElement>);
            break;
          case "setHeight":
            handleHeightChange({
              target: { value: params as string },
            } as ChangeEvent<HTMLInputElement>);
            break;
          case "setUnit":
            setUnitOfMeasure(params as string);
            break;
          case "resetCalibration":
            handleResetCalibration();
            break;
          case "toggleMovePad":
            setShowingMovePad(!showingMovePad);
            break;
          // Calibration movement actions (move corners)
          case "moveCorner": {
            const { direction, pixels } = params as {
              direction: Direction;
              pixels: number;
            };
            const offset = getOffset(direction, pixels);
            if (corners.size > 0) {
              dispatchPoints({ type: "offset", offset, corners });
            }
            break;
          }
          case "cycleCorner": {
            const newCorners = new Set<number>();
            corners.forEach((c) => {
              newCorners.add((c + 1) % 4);
            });
            setCorners(newCorners);
            break;
          }
          case "saveCalibrationContext": {
            // Save calibration context after move operations
            localStorage.setItem(
              "calibrationContext",
              JSON.stringify(getCalibrationContext(fullScreenActive)),
            );
            break;
          }
          // View panning actions (project mode)
          case "panView": {
            const { direction: panDir, pixels: panPixels } = params as {
              direction: Direction;
              pixels: number;
            };
            const panOffset = getOffset(panDir, panPixels);
            // Negate the offset: pressing "right" should move viewport right,
            // which means moving the pattern left (negative x)
            transformer.translate({ x: -panOffset.x, y: -panOffset.y });
            break;
          }
          case "rotateView": {
            const degrees = (params as number) ?? 15;
            const center = getCalibrationCenterPoint(
              width,
              height,
              unitOfMeasure,
            );
            transformer.rotate(center, degrees);
            break;
          }
          // Mini map navigation - navigate to a point in PDF coordinates
          case "navigateToPoint": {
            const { x, y } = params as { x: number; y: number };
            const center = getCalibrationCenterPoint(
              width,
              height,
              unitOfMeasure,
            );

            // If zoomed out, exit zoom out mode and center on the clicked point
            if (zoomedOut && restoreTransforms) {
              // Use the saved localTransform to calculate the new centered position
              const oldLocal = restoreTransforms.localTransform;
              const m = oldLocal.to1DArray();

              // Calculate where the clicked point (x, y) would be in screen coords with the saved transform
              const destX = x * m[0] + y * m[1] + m[2];
              const destY = x * m[3] + y * m[4] + m[5];

              // Create new transform that centers on that point
              const newLocal = translate({
                x: -destX + center.x,
                y: -destY + center.y,
              }).mmul(oldLocal);

              // Set the new transform and exit zoom out mode
              transformer.setLocalTransform(newLocal);
              setZoomedOut(false);
              break;
            }

            // Normal navigation (not zoomed out)
            // Get current viewport center from the transform
            // The localTransform maps PDF coords to screen coords
            // We want to find what offset would put (x, y) at the screen center

            // Current translation is stored in the matrix
            const m = localTransform.to1DArray();
            const currentTx = m[2];
            const currentTy = m[5];

            // The point (x, y) in PDF space should map to screen center
            // With current transform: screenX = x * m[0] + y * m[1] + m[2]
            // We want: center.x = x * m[0] + y * m[1] + newTx
            // So: newTx = center.x - (x * m[0] + y * m[1])
            // Delta = newTx - currentTx = center.x - (x * m[0] + y * m[1]) - currentTx

            // Simpler approach: calculate the offset needed
            // We want to translate so that point (x,y) ends up at screen center
            const targetScreenX = x * m[0] + y * m[1] + currentTx;
            const targetScreenY = x * m[3] + y * m[4] + currentTy;

            const deltaX = center.x - targetScreenX;
            const deltaY = center.y - targetScreenY;

            transformer.translate({ x: deltaX, y: deltaY });
            break;
          }
          // Magnify at a specific point in PDF coordinates (from mini map)
          case "magnifyAtPoint": {
            const { x, y } = params as { x: number; y: number };
            const center = getCalibrationCenterPoint(
              width,
              height,
              unitOfMeasure,
            );

            if (magnifying && !restoreTransforms) {
              // Not yet magnified - save transforms and magnify at the point
              // Save current state before magnifying (same as draggable.tsx does)
              setRestoreTransforms({
                localTransform: localTransform.clone(),
                calibrationTransform: calibrationTransform.clone(),
              });

              // The point (x, y) is in PDF coordinates
              // We need to: 1) translate so the point is at screen center, 2) scale by 5x
              // This is similar to navigateToPoint but with an additional scale
              const m = localTransform.to1DArray();

              // Calculate where the PDF point (x, y) would be in screen coords
              const screenX = x * m[0] + y * m[1] + m[2];
              const screenY = x * m[3] + y * m[4] + m[5];

              // Create a new transform that:
              // 1. Translates so the clicked point is at screen center
              // 2. Scales by 5x around the screen center
              const translateToCenter = translate({
                x: center.x - screenX,
                y: center.y - screenY,
              });
              const scaleAtCenter = scaleAboutPoint(5, center);

              // Apply: first translate to center, then scale around center
              const newTransform = scaleAtCenter
                .mmul(translateToCenter)
                .mmul(localTransform);
              transformer.setLocalTransform(newTransform);
            } else if (magnifying && restoreTransforms) {
              // Already magnified - exit magnify mode
              setMagnifying(false);
            }
            break;
          }
          // Layer actions
          case "toggleLayer":
            dispatchLayerAction({
              type: "toggle-layer",
              key: params as string,
            });
            break;
          case "toggleAllLayers":
            const someVisible = Object.values(layers).some((l) => l.visible);
            dispatchLayerAction({
              type: someVisible ? "hide-all" : "show-all",
            });
            break;
          // Stitch actions
          case "setStitchPageRange":
            dispatchStitchSettings({
              type: "set-page-range",
              pageRange: params as string,
            });
            break;
          case "setStitchLineDirection":
            dispatchStitchSettings({
              type: "set",
              stitchSettings: {
                ...stitchSettings,
                lineDirection:
                  LineDirection[params as keyof typeof LineDirection],
              },
            });
            break;
          case "setStitchLineCount":
            dispatchStitchSettings({
              type: "set-line-count",
              lineCount: params ? Number(params) : 0,
              pageCount,
            });
            break;
          case "stepStitchLineCount":
            dispatchStitchSettings({
              type: "step-line-count",
              pageCount,
              step: params as number,
            });
            break;
          case "setStitchEdgeInsetHorizontal":
            dispatchStitchSettings({
              type: "set-edge-insets",
              edgeInsets: {
                ...stitchSettings.edgeInsets,
                horizontal: params ? Number(params) : 0,
              },
            });
            break;
          case "stepStitchHorizontal":
            dispatchStitchSettings({
              type: "step-horizontal",
              step: params as number,
            });
            break;
          case "setStitchEdgeInsetVertical":
            dispatchStitchSettings({
              type: "set-edge-insets",
              edgeInsets: {
                ...stitchSettings.edgeInsets,
                vertical: params ? Number(params) : 0,
              },
            });
            break;
          case "stepStitchVertical":
            dispatchStitchSettings({
              type: "step-vertical",
              step: params as number,
            });
            break;
          // Preview image toggle
          case "togglePreviewImage":
            setShowPreviewImage(!showPreviewImage);
            break;
        }
      }
    },
    [
      transformer,
      width,
      height,
      unitOfMeasure,
      layoutWidth,
      layoutHeight,
      displaySettings,
      setDisplaySettings,
      isCalibrating,
      setIsCalibrating,
      zoomedOut,
      setZoomedOut,
      magnifying,
      setMagnifying,
      restoreTransforms,
      setRestoreTransforms,
      calibrationTransform,
      measuring,
      setMeasuring,
      setLineThickness,
      patternScale,
      dispatchPatternScaleAction,
      menuStates,
      setMenuStates,
      handleWidthChange,
      handleHeightChange,
      setUnitOfMeasure,
      handleResetCalibration,
      fileInputRef,
      getCalibrationCenterPoint,
      setFile,
      showingMovePad,
      setShowingMovePad,
      corners,
      setCorners,
      dispatchPoints,
      layers,
      dispatchLayerAction,
      stitchSettings,
      dispatchStitchSettings,
      pageCount,
      setCalibrationValidated,
      fullScreenActive,
      file,
      showPreviewImage,
      setShowPreviewImage,
      localTransform,
    ],
  );

  const { sendStateSync } = useBroadcastChannel(handleMessage);

  // Sync state to control panel whenever it changes
  useEffect(() => {
    sendStateSync(buildState());
  }, [buildState, sendStateSync]);

  // Handle sync requests - check periodically if a sync was requested
  useEffect(() => {
    const interval = setInterval(() => {
      if (syncRequestedRef.current) {
        syncRequestedRef.current = false;
        sendStateSync(buildState());
      }
    }, 100);
    return () => clearInterval(interval);
  }, [buildState, sendStateSync]);

  // Send initial sync on mount
  useEffect(() => {
    // Small delay to ensure channel is ready
    const timeout = setTimeout(() => {
      sendStateSync(buildState());
    }, 100);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // This component doesn't render anything - it just handles communication
  return null;
}
