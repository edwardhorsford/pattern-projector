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
import {
  DisplaySettings,
  getDefaultDisplaySettings,
  themes,
  Theme,
} from "@/_lib/display-settings";
import {
  getDefaultMenuStates,
  MenuStates,
  SideMenuType,
  toggleSideMenuStates,
} from "@/_lib/menu-states";
import { Dispatch, SetStateAction, ChangeEvent, RefObject } from "react";
import { PatternScaleAction } from "@/_reducers/patternScaleReducer";
import { applyPatternScaleDelta } from "@/_reducers/patternScaleReducer";
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
  getBounds,
  getViewportQuad,
  RestoreTransforms,
  translate,
  scale,
  scaleAboutPoint,
} from "@/_lib/geometry";
import { inverse } from "ml-matrix";
import { getPtDensity, Unit } from "@/_lib/unit";
import { Marker, createMarker } from "@/_lib/marker";
import { useKeyDown } from "@/_hooks/use-key-down";
import { KeyCode } from "@/_lib/key-code";
import {
  Line,
  LinesAction,
  createLine,
  transformLine,
} from "@/_reducers/linesReducer";
import { subtract } from "@/_lib/point";
import { LoadStatusEnum } from "@/_lib/load-status-enum";
import { clearRenderCache } from "@/_components/pdf-custom-renderer";

const defaultStitchSettings: StitchSettings = {
  key: "stitchSettings:default",
  lineCount: 1,
  edgeInsets: { horizontal: 0, vertical: 0 },
  pageRange: "1-",
  lineDirection: LineDirection.Column,
};

type ProjectScaleDetail =
  | { type: "delta"; delta: number; anchor: Point }
  | { type: "set"; scale: number; anchor: Point };

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
  unitOfMeasure: Unit;
  setUnitOfMeasure: (unit: Unit) => void;
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
    unitOfMeasure: Unit,
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
  points: Point[];
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
  fileLoadStatus: LoadStatusEnum;
  lineThicknessStatus: LoadStatusEnum;
  // Markers for "mark complete" feature
  markers: Marker[];
  setMarkers: (markers: Marker[]) => void;
  markingMode: boolean;
  setMarkingMode: (value: boolean) => void;
  clearingMode: boolean;
  setClearingMode: (value: boolean) => void;
  // Lines for measure tool
  lines: Line[];
  dispatchLines: Dispatch<LinesAction>;
  selectedLine: number;
  setSelectedLine: Dispatch<SetStateAction<number>>;
  // Forces the PDF renderer to re-render all pages from scratch
  forcePdfRerender: () => void;
  /** Dev toggle: hide/show the high-res viewport overlay canvas. */
  showHighResOverlay: boolean;
  setShowHighResOverlay: (value: boolean) => void;
  /** Dev toggle: tint the high-res overlay amber for alignment testing. */
  debugTintHighRes: boolean;
  setDebugTintHighRes: (value: boolean) => void;
  /** Dev toggle: force very low-res base render so the high-res overlay effect is obvious. */
  debugLowResBase: boolean;
  setDebugLowResBase: (value: boolean) => void;
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
  points,
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
  fileLoadStatus,
  lineThicknessStatus,
  markers,
  setMarkers,
  markingMode,
  setMarkingMode,
  clearingMode,
  setClearingMode,
  lines,
  dispatchLines,
  selectedLine,
  setSelectedLine,
  forcePdfRerender,
  showHighResOverlay,
  setShowHighResOverlay,
  debugTintHighRes,
  setDebugTintHighRes,
  debugLowResBase,
  setDebugLowResBase,
}: ControlPanelBridgeProps) {
  const transformer = useTransformerContext();
  const localTransform = useTransformContext();
  const syncRequestedRef = useRef(false);
  const localTransformRef = useRef(localTransform);
  const perspectiveRef = useRef(perspective);
  const patternScaleRef = useRef(Number(patternScale) || 1);
  const zoomedOutRef = useRef(zoomedOut);
  const magnifyingRef = useRef(magnifying);
  const calibrationPresetRef = useRef<"none" | "moderate" | "extreme">("none");
  const fileRenderStartRef = useRef<number | null>(null);
  const thumbnailRenderStartRef = useRef<number | null>(null);
  const fileRenderDurationMsRef = useRef<number | null>(null);
  const thumbnailRenderDurationMsRef = useRef<number | null>(null);

  useEffect(() => {
    localTransformRef.current = localTransform;
  }, [localTransform]);

  useEffect(() => {
    perspectiveRef.current = perspective;
  }, [perspective]);

  useEffect(() => {
    patternScaleRef.current = Number(patternScale) || 1;
  }, [patternScale]);

  useEffect(() => {
    zoomedOutRef.current = zoomedOut;
  }, [zoomedOut]);

  useEffect(() => {
    magnifyingRef.current = magnifying;
  }, [magnifying]);

  useEffect(() => {
    if (!file) {
      fileRenderStartRef.current = null;
      fileRenderDurationMsRef.current = null;
      thumbnailRenderStartRef.current = null;
      thumbnailRenderDurationMsRef.current = null;
      return;
    }

    fileRenderStartRef.current = performance.now();
    fileRenderDurationMsRef.current = null;
  }, [file]);

  useEffect(() => {
    if (fileLoadStatus === LoadStatusEnum.LOADING) {
      if (fileRenderStartRef.current === null) {
        fileRenderStartRef.current = performance.now();
      }
      return;
    }

    const startedAt = fileRenderStartRef.current;
    const canFinish =
      startedAt !== null &&
      (fileLoadStatus === LoadStatusEnum.SUCCESS ||
        fileLoadStatus === LoadStatusEnum.FAILED);

    if (canFinish) {
      fileRenderDurationMsRef.current = Math.max(
        0,
        performance.now() - startedAt,
      );
      fileRenderStartRef.current = null;
    }
  }, [fileLoadStatus]);

  useEffect(() => {
    if (isPreviewLoading) {
      if (thumbnailRenderStartRef.current === null) {
        thumbnailRenderStartRef.current = performance.now();
      }
      return;
    }

    if (thumbnailRenderStartRef.current !== null) {
      thumbnailRenderDurationMsRef.current = Math.max(
        0,
        performance.now() - thumbnailRenderStartRef.current,
      );
      thumbnailRenderStartRef.current = null;
    }
  }, [isPreviewLoading]);

  // When zoomed out or magnifying, use the saved transform for preview display
  // This preserves the rotation/flip state in the preview even though the actual
  // localTransform is reset to identity during zoom out
  const effectiveTransform =
    (zoomedOut || magnifying) && restoreTransforms
      ? restoreTransforms.localTransform
      : localTransform;

  const applyPatternScale = useCallback(
    (nextScaleRaw: number, anchorScreenPoint: Point) => {
      if (!Number.isFinite(nextScaleRaw)) {
        return;
      }
      const currentScale = patternScaleRef.current;
      const nextScale = Math.max(0.25, Math.min(10, nextScaleRaw));
      if (Math.abs(nextScale - currentScale) < 0.0001) {
        return;
      }

      if (!zoomedOutRef.current && !magnifyingRef.current) {
        try {
          const scaleRatio = nextScale / currentScale;
          const anchorInCalibratedSpace = transformPoint(
            anchorScreenPoint,
            perspectiveRef.current,
          );
          const anchorInPatternSpace = transformPoint(
            anchorInCalibratedSpace,
            inverse(localTransformRef.current),
          );
          const scaledAnchorInPatternSpace = {
            x: anchorInPatternSpace.x * scaleRatio,
            y: anchorInPatternSpace.y * scaleRatio,
          };
          const anchorAfterScaleInCalibratedSpace = transformPoint(
            scaledAnchorInPatternSpace,
            localTransformRef.current,
          );
          const translateDelta = {
            x: anchorInCalibratedSpace.x - anchorAfterScaleInCalibratedSpace.x,
            y: anchorInCalibratedSpace.y - anchorAfterScaleInCalibratedSpace.y,
          };

          transformer.translate({
            x: translateDelta.x,
            y: translateDelta.y,
          });

          localTransformRef.current = translate(translateDelta).mmul(
            localTransformRef.current,
          );
        } catch {
          // No-op fallback; scale still applies below.
        }
      }

      patternScaleRef.current = nextScale;

      dispatchPatternScaleAction({
        type: "set",
        scale: nextScale.toFixed(2),
      });
    },
    [dispatchPatternScaleAction, transformer],
  );

  const getCalibrationCenterScreenAnchor = useCallback(() => {
    const calibrationCenter = getCalibrationCenterPoint(
      width,
      height,
      unitOfMeasure,
    );
    return transformPoint(calibrationCenter, calibrationTransform);
  }, [
    getCalibrationCenterPoint,
    width,
    height,
    unitOfMeasure,
    calibrationTransform,
  ]);

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

  const buildCalibrationPoints = useCallback(
    (targetWidthRaw: number, targetHeightRaw: number): Point[] => {
      const { innerWidth, innerHeight } = window;
      const targetWidth = targetWidthRaw > 0 ? targetWidthRaw : 1;
      const targetHeight = targetHeightRaw > 0 ? targetHeightRaw : 1;
      const targetAspectRatio = targetWidth / targetHeight;

      const maxGridWidth = innerWidth * 0.7;
      const maxGridHeight = innerHeight * 0.7;

      let gridWidth = maxGridWidth;
      let gridHeight = gridWidth / targetAspectRatio;

      if (gridHeight > maxGridHeight) {
        gridHeight = maxGridHeight;
        gridWidth = gridHeight * targetAspectRatio;
      }

      const minX = (innerWidth - gridWidth) * 0.5;
      const minY = (innerHeight - gridHeight) * 0.5;

      return [
        { x: minX, y: minY },
        { x: minX + gridWidth, y: minY },
        { x: minX + gridWidth, y: minY + gridHeight },
        { x: minX, y: minY + gridHeight },
      ];
    },
    [],
  );

  const buildNoneCalibrationPoints = useCallback(
    (): Point[] => buildCalibrationPoints(width, height),
    [buildCalibrationPoints, width, height],
  );

  const buildNoneCalibrationPointsForSize = useCallback(
    (targetWidth: number, targetHeight: number): Point[] =>
      buildCalibrationPoints(targetWidth, targetHeight),
    [buildCalibrationPoints],
  );

  const buildModerateCalibrationPoints = useCallback((): Point[] => {
    const none = buildNoneCalibrationPoints();

    if (none.length < 4) {
      return none;
    }

    const gridWidth = none[1].x - none[0].x;
    const gridHeight = none[2].y - none[1].y;
    const topInset = gridWidth * 0.12;
    const bottomInset = gridWidth * 0.03;
    const verticalDrift = gridHeight * 0.02;

    return [
      { x: none[0].x + topInset, y: none[0].y + verticalDrift },
      { x: none[1].x - topInset, y: none[1].y - verticalDrift },
      { x: none[2].x - bottomInset, y: none[2].y },
      { x: none[3].x + bottomInset, y: none[3].y },
    ];
  }, [buildNoneCalibrationPoints]);

  const buildModerateCalibrationPointsForSize = useCallback(
    (targetWidth: number, targetHeight: number): Point[] => {
      const none = buildNoneCalibrationPointsForSize(targetWidth, targetHeight);

      if (none.length < 4) {
        return none;
      }

      const gridWidth = none[1].x - none[0].x;
      const gridHeight = none[2].y - none[1].y;
      const topInset = gridWidth * 0.12;
      const bottomInset = gridWidth * 0.03;
      const verticalDrift = gridHeight * 0.02;

      return [
        { x: none[0].x + topInset, y: none[0].y + verticalDrift },
        { x: none[1].x - topInset, y: none[1].y - verticalDrift },
        { x: none[2].x - bottomInset, y: none[2].y },
        { x: none[3].x + bottomInset, y: none[3].y },
      ];
    },
    [buildNoneCalibrationPointsForSize],
  );

  const buildExtremeCalibrationPoints = useCallback((): Point[] => {
    const none = buildNoneCalibrationPoints();

    if (none.length < 4) {
      return none;
    }

    const gridWidth = none[1].x - none[0].x;
    const gridHeight = none[2].y - none[1].y;
    const topInset = gridWidth * 0.2;
    const bottomInset = gridWidth * 0.01;
    const verticalDrift = gridHeight * 0.045;

    return [
      { x: none[0].x + topInset, y: none[0].y + verticalDrift },
      { x: none[1].x - topInset, y: none[1].y - verticalDrift },
      { x: none[2].x - bottomInset, y: none[2].y },
      { x: none[3].x + bottomInset, y: none[3].y },
    ];
  }, [buildNoneCalibrationPoints]);

  const buildExtremeCalibrationPointsForSize = useCallback(
    (targetWidth: number, targetHeight: number): Point[] => {
      const none = buildNoneCalibrationPointsForSize(targetWidth, targetHeight);

      if (none.length < 4) {
        return none;
      }

      const gridWidth = none[1].x - none[0].x;
      const gridHeight = none[2].y - none[1].y;
      const topInset = gridWidth * 0.2;
      const bottomInset = gridWidth * 0.01;
      const verticalDrift = gridHeight * 0.045;

      return [
        { x: none[0].x + topInset, y: none[0].y + verticalDrift },
        { x: none[1].x - topInset, y: none[1].y - verticalDrift },
        { x: none[2].x - bottomInset, y: none[2].y },
        { x: none[3].x + bottomInset, y: none[3].y },
      ];
    },
    [buildNoneCalibrationPointsForSize],
  );

  const getPointDistance = useCallback((left: Point, right: Point) => {
    const dx = left.x - right.x;
    const dy = left.y - right.y;
    return Math.sqrt(dx * dx + dy * dy);
  }, []);

  const calculateProfileDistance = useCallback(
    (currentPoints: Point[], profilePoints: Point[]) => {
      if (currentPoints.length !== 4 || profilePoints.length !== 4) {
        return Number.POSITIVE_INFINITY;
      }

      return (
        currentPoints.reduce((sum, point, index) => {
          return sum + getPointDistance(point, profilePoints[index]);
        }, 0) / 4
      );
    },
    [getPointDistance],
  );

  const getActiveCalibrationProfile = useCallback(() => {
    if (points.length !== 4) {
      return "custom" as const;
    }

    const noneDistance = calculateProfileDistance(
      points,
      buildNoneCalibrationPoints(),
    );
    const moderateDistance = calculateProfileDistance(
      points,
      buildModerateCalibrationPoints(),
    );
    const extremeDistance = calculateProfileDistance(
      points,
      buildExtremeCalibrationPoints(),
    );

    const profiles = [
      { name: "none" as const, distance: noneDistance },
      { name: "moderate" as const, distance: moderateDistance },
      { name: "extreme" as const, distance: extremeDistance },
    ];

    const nearest = profiles.reduce((best, current) => {
      return current.distance < best.distance ? current : best;
    }, profiles[0]);

    // Small tolerance to account for viewport/pixel rounding while still flagging manual edits as custom.
    const maxProfileDistancePx = 6;
    if (nearest.distance > maxProfileDistancePx) {
      return "custom" as const;
    }

    return nearest.name;
  }, [
    points,
    calculateProfileDistance,
    buildNoneCalibrationPoints,
    buildModerateCalibrationPoints,
    buildExtremeCalibrationPoints,
  ]);

  useEffect(() => {
    const activeProfile = getActiveCalibrationProfile();
    if (activeProfile !== "custom") {
      calibrationPresetRef.current = activeProfile;
    }
  }, [getActiveCalibrationProfile]);

  const clearAppData = useCallback(() => {
    const removableExactKeys = new Set([
      "points",
      "canvasSettings",
      "menuPosition",
      "calibrationContext",
      "mailRead",
      "installed",
      "undefined",
    ]);

    const removablePrefixKeys = [
      "lineThickness:",
      "stitchSettings:",
      "visibleLayers:",
      "localTransform:",
    ];

    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key === null) {
        continue;
      }

      if (
        removableExactKeys.has(key) ||
        removablePrefixKeys.some((prefix) => key.startsWith(prefix))
      ) {
        localStorage.removeItem(key);
      }
    }

    setIsCalibrating(true);
    setZoomedOut(false);
    setMagnifying(false);
    setMeasuring(false);
    setRestoreTransforms(null);
    setCalibrationValidated(false);

    setDisplaySettings(getDefaultDisplaySettings());
    setMenuStates(getDefaultMenuStates());
    setUnitOfMeasure(Unit.CM);
    handleWidthChange({
      target: { value: "60" },
    } as ChangeEvent<HTMLInputElement>);
    handleHeightChange({
      target: { value: "40" },
    } as ChangeEvent<HTMLInputElement>);

    dispatchPoints({
      type: "set",
      points: buildNoneCalibrationPoints(),
    });
    setCorners(new Set([0]));

    setFile(null);
    setLineThickness(0);
    setShowPreviewImage(true);

    dispatchPatternScaleAction({
      type: "set",
      scale: "1.00",
    });

    dispatchLayerAction({
      type: "set-layers",
      layers: {},
    });

    dispatchStitchSettings({
      type: "set",
      stitchSettings: defaultStitchSettings,
    });

    setMarkers([]);
    setMarkingMode(false);
    setClearingMode(false);
    dispatchLines({ type: "reset" });
    setSelectedLine(-1);

    transformer.reset();
  }, [
    setIsCalibrating,
    setZoomedOut,
    setMagnifying,
    setMeasuring,
    setRestoreTransforms,
    setCalibrationValidated,
    setDisplaySettings,
    setMenuStates,
    setUnitOfMeasure,
    handleWidthChange,
    handleHeightChange,
    dispatchPoints,
    buildNoneCalibrationPoints,
    setCorners,
    setFile,
    setLineThickness,
    setShowPreviewImage,
    dispatchPatternScaleAction,
    dispatchLayerAction,
    dispatchStitchSettings,
    setMarkers,
    setMarkingMode,
    setClearingMode,
    dispatchLines,
    setSelectedLine,
    transformer,
  ]);

  // Calculate viewport bounds in pattern space for mini map
  const calculateViewportBounds = useCallback(() => {
    if (layoutWidth === 0 || layoutHeight === 0) {
      return null;
    }

    // Get screen corners (browser window dimensions)
    const screenWidth = typeof window !== "undefined" ? window.innerWidth : 0;
    const screenHeight = typeof window !== "undefined" ? window.innerHeight : 0;

    // Transform screen corners to pattern space coordinates using inverse of combined transform.
    // Uses the ACTUAL current localTransform (not effectiveTransform) so the viewport
    // reflects the real current view position, even during zoom out.
    try {
      const pdfCorners = getViewportQuad(
        perspective,
        localTransform,
        screenWidth,
        screenHeight,
      );

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

  // Calculate calibration bounds in pattern space for mini map border
  // This represents the fixed calibration rectangle (what the projector can display) in pattern space
  // The size is fixed (width x height in calibration units), but position changes with pan/rotate
  const calculateCalibrationBounds = useCallback(() => {
    if (width === 0 || height === 0) {
      return null;
    }

    // Calculate calibration size in pattern space (CSS px at 96px/inch)
    const ptDensity = getPtDensity(unitOfMeasure);
    const calWidth = width * ptDensity;
    const calHeight = height * ptDensity;

    // The calibration area in pattern space is (0,0) to (calWidth, calHeight)
    // Transform corners to pre-pan/zoom pattern space using inverse of localTransform
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

      // Get bounding box in pattern space
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

  // Calculate paper sheet bounds in pattern space for mini map
  // Paper sheet is centered in the calibration area, sized for A4 (CM) or Letter (IN)
  const calculatePaperBounds = useCallback(() => {
    if (width === 0 || height === 0) {
      return null;
    }

    // Paper dimensions based on unit of measure (matching drawing.ts drawPaperSheet)
    const [paperWidth, paperHeight] =
      unitOfMeasure === Unit.CM ? [29.7, 21] : [11, 8.5];

    // Calculate calibration size in the current unit
    const calWidth = width;
    const calHeight = height;

    // Paper is centered in calibration area (in calibration units)
    const paperX = (calWidth - paperWidth) * 0.5;
    const paperY = (calHeight - paperHeight) * 0.5;

    // Convert to pattern space (CSS px at 96px/inch)
    const ptDensity = getPtDensity(unitOfMeasure);
    const paperWidthPts = paperWidth * ptDensity;
    const paperHeightPts = paperHeight * ptDensity;
    const paperXPts = paperX * ptDensity;
    const paperYPts = paperY * ptDensity;

    // Transform corners to pre-pan/zoom pattern space using inverse of localTransform
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

      // Get bounding box in pattern space
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

  const calculateCalibrationCenterPoint = useCallback(() => {
    try {
      const calibratedCenter = getCalibrationCenterPoint(
        width,
        height,
        unitOfMeasure,
      );
      const inverseLocal = inverse(
        localTransform.mmul(scale(Number(patternScale) || 1)),
      );
      return transformPoint(calibratedCenter, inverseLocal);
    } catch {
      return null;
    }
  }, [
    getCalibrationCenterPoint,
    width,
    height,
    unitOfMeasure,
    localTransform,
    patternScale,
  ]);

  // Keyboard shortcut X for "mark area complete" - marks the center of the current viewport
  useKeyDown(() => {
    // Only work when projecting (not calibrating), not zoomed out, and not magnifying
    if (!isCalibrating && !zoomedOut && !magnifying) {
      const center = calculateCalibrationCenterPoint();
      if (center) {
        const newMarker = createMarker(center);
        setMarkers([...markers, newMarker]);
      }
    }
  }, [KeyCode.KeyX]);

  // Keyboard shortcut Cmd/Ctrl+Z for undo last marker placement
  useEffect(() => {
    const handleUndo = (e: KeyboardEvent) => {
      // Check for Cmd+Z (Mac) or Ctrl+Z (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        // Only undo markers when projecting (not calibrating), not in special modes
        if (!isCalibrating && !zoomedOut && !magnifying && markers.length > 0) {
          e.preventDefault();
          // Remove the most recently placed marker (last in array)
          const newMarkers = [...markers];
          newMarkers.pop();
          setMarkers(newMarkers);
        }
      }
    };

    document.addEventListener("keydown", handleUndo);
    return () => document.removeEventListener("keydown", handleUndo);
  }, [isCalibrating, zoomedOut, magnifying, markers, setMarkers]);

  useEffect(() => {
    const handleProjectScaleEvent = (event: Event) => {
      if (isCalibrating) {
        return;
      }
      const detail = (event as CustomEvent<ProjectScaleDetail>).detail;
      if (!detail) {
        return;
      }

      if (detail.type === "delta") {
        const currentScale = Number(patternScale) || 1;
        applyPatternScale(
          applyPatternScaleDelta(currentScale, detail.delta),
          detail.anchor,
        );
      } else {
        applyPatternScale(detail.scale, detail.anchor);
      }
    };

    window.addEventListener(
      "project-scale",
      handleProjectScaleEvent as EventListener,
    );
    return () => {
      window.removeEventListener(
        "project-scale",
        handleProjectScaleEvent as EventListener,
      );
    };
  }, [applyPatternScale, isCalibrating, patternScale]);

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
      calibrationProfile: getActiveCalibrationProfile(),
      // Preview data
      previewImage: pdfThumbnail,
      isPreviewLoading,
      previewSourceType:
        file?.type === "application/pdf"
          ? "pdf"
          : file?.type === "image/svg+xml"
            ? "svg"
            : "none",
      showPreviewImage,
      fileLoadStatus,
      lineThicknessStatus,
      renderMetrics: {
        fileRenderDurationMs:
          fileRenderDurationMsRef.current !== null
            ? Math.round(fileRenderDurationMsRef.current)
            : null,
        fileRenderInProgressMs:
          fileRenderStartRef.current !== null
            ? Math.round(
                Math.max(0, performance.now() - fileRenderStartRef.current),
              )
            : null,
        thumbnailRenderDurationMs:
          thumbnailRenderDurationMsRef.current !== null
            ? Math.round(thumbnailRenderDurationMsRef.current)
            : null,
        thumbnailRenderInProgressMs:
          thumbnailRenderStartRef.current !== null
            ? Math.round(
                Math.max(
                  0,
                  performance.now() - thumbnailRenderStartRef.current,
                ),
              )
            : null,
      },
      viewportBounds: calculateViewportBounds(),
      calibrationBounds: calculateCalibrationBounds(),
      paperBounds: calculatePaperBounds(),
      layoutWidth,
      layoutHeight,
      // Markers for "mark complete" feature
      markers,
      markingMode,
      clearingMode,
      // Lines for measure tool
      lines,
      selectedLine,
      // Dev toggles — included so the control panel checkboxes stay in sync
      // with the calibrate page state on initial load.
      showHighResOverlay,
      debugTintHighRes,
      debugLowResBase,
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
      fileLoadStatus,
      lineThicknessStatus,
      calculateViewportBounds,
      calculateCalibrationBounds,
      calculatePaperBounds,
      getActiveCalibrationProfile,
      layoutWidth,
      layoutHeight,
      markers,
      markingMode,
      clearingMode,
      lines,
      selectedLine,
      showHighResOverlay,
      debugTintHighRes,
      debugLowResBase,
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
            // Reset rotation first, then recenter - matching main window behavior
            transformer.reset();
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
          case "setTheme":
            setDisplaySettings({
              ...displaySettings,
              theme: params as Theme,
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
          case "setBrightness":
            setDisplaySettings({
              ...displaySettings,
              brightness: params as number,
            });
            break;
          case "adjustScale": {
            const delta = params as number;
            const screenCenterAnchor = getCalibrationCenterScreenAnchor();
            applyPatternScale(
              applyPatternScaleDelta(Number(patternScale) || 1, delta),
              screenCenterAnchor,
            );
            break;
          }
          case "resetScale": {
            const screenCenterAnchor = getCalibrationCenterScreenAnchor();
            applyPatternScale(1, screenCenterAnchor);
            break;
          }
          case "setScale": {
            const screenCenterAnchor = getCalibrationCenterScreenAnchor();
            applyPatternScale(Number(params), screenCenterAnchor);
            break;
          }
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
            setUnitOfMeasure(params as Unit);
            break;
          case "resetCalibration":
            handleResetCalibration();
            break;
          case "clearImageCache":
            clearRenderCache();
            forcePdfRerender();
            break;
          case "setShowHighResOverlay":
            setShowHighResOverlay(params as boolean);
            break;
          case "setDebugTintHighRes":
            setDebugTintHighRes(params as boolean);
            break;
          case "setDebugLowResBase":
            setDebugLowResBase(params as boolean);
            break;
          case "clearAppData":
            clearAppData();
            break;
          case "applyCalibrationPreset": {
            const preset =
              params === "extreme"
                ? "extreme"
                : params === "moderate"
                  ? "moderate"
                  : ("none" as const);
            calibrationPresetRef.current = preset;
            dispatchPoints({
              type: "set",
              points:
                preset === "extreme"
                  ? buildExtremeCalibrationPoints()
                  : preset === "moderate"
                    ? buildModerateCalibrationPoints()
                    : buildNoneCalibrationPoints(),
            });
            setCorners(new Set([0]));
            break;
          }
          case "setCalibrationSizePreset": {
            const { width: presetWidth, height: presetHeight } = (params as {
              width: string;
              height: string;
            }) ?? {
              width: "60",
              height: "40",
            };

            // Compute old and new calibration centres so we can keep the
            // view centred when the grid size changes.
            const oldCenter = getCalibrationCenterPoint(
              width,
              height,
              unitOfMeasure,
            );
            const parsedWidth = Math.max(1, Number(presetWidth) || 1);
            const parsedHeight = Math.max(1, Number(presetHeight) || 1);
            const newCenter = getCalibrationCenterPoint(
              parsedWidth,
              parsedHeight,
              unitOfMeasure,
            );

            handleWidthChange({
              target: { value: presetWidth },
            } as ChangeEvent<HTMLInputElement>);
            handleHeightChange({
              target: { value: presetHeight },
            } as ChangeEvent<HTMLInputElement>);

            dispatchPoints({
              type: "set",
              points:
                calibrationPresetRef.current === "extreme"
                  ? buildExtremeCalibrationPointsForSize(
                      parsedWidth,
                      parsedHeight,
                    )
                  : calibrationPresetRef.current === "moderate"
                    ? buildModerateCalibrationPointsForSize(
                        parsedWidth,
                        parsedHeight,
                      )
                    : buildNoneCalibrationPointsForSize(
                        parsedWidth,
                        parsedHeight,
                      ),
            });

            // Translate the local transform so the content follows the
            // calibration centre rather than appearing to jump.
            transformer.translate({
              x: newCenter.x - oldCenter.x,
              y: newCenter.y - oldCenter.y,
            });

            setCorners(new Set([0]));
            break;
          }
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
          case "panViewDelta": {
            // Direct delta panning from preview drag (in calibrated space units)
            const { dx, dy } = params as { dx: number; dy: number };
            transformer.translate({ x: dx, y: dy });
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
          // Mini map navigation - navigate to a point in pattern space coordinates
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
              // Transform the clicked point through the saved transform
              const current = transformPoint({ x, y }, oldLocal);

              // Create new transform that centers on that point
              const newLocal = translate({
                x: center.x - current.x,
                y: center.y - current.y,
              }).mmul(oldLocal);

              // Set the new transform and exit zoom out mode
              transformer.setLocalTransform(newLocal);
              setZoomedOut(false);
              break;
            }

            // Normal navigation (not zoomed out)
            // Transform the clicked point through localTransform (same as recenter does)
            const current = transformPoint({ x, y }, localTransform);

            // Move from current position to calibration center
            const deltaX = center.x - current.x;
            const deltaY = center.y - current.y;

            transformer.translate({ x: deltaX, y: deltaY });
            break;
          }
          // Magnify at a specific point in pattern space coordinates (from mini map)
          case "magnifyAtPoint": {
            const { x, y } = params as { x: number; y: number };
            const center = getCalibrationCenterPoint(
              width,
              height,
              unitOfMeasure,
            );

            if (magnifying && !restoreTransforms) {
              // Not yet magnified - save transforms and magnify at the point
              setRestoreTransforms({
                localTransform: localTransform.clone(),
                calibrationTransform: calibrationTransform.clone(),
              });

              // Transform the clicked point through localTransform
              const current = transformPoint({ x, y }, localTransform);

              // Create a new transform that centers on that point then scales
              const translateToCenter = translate({
                x: center.x - current.x,
                y: center.y - current.y,
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
          // Marker actions for "mark complete" feature
          case "toggleMarkingMode":
            // When enabling marking mode, disable clearing mode
            if (!markingMode) {
              setClearingMode(false);
            }
            setMarkingMode(!markingMode);
            break;
          case "toggleClearingMode":
            // When enabling clearing mode, disable marking mode
            if (!clearingMode) {
              setMarkingMode(false);
            }
            setClearingMode(!clearingMode);
            break;
          case "markViewCenter": {
            // Place a marker at the center of the current viewport
            const center = calculateCalibrationCenterPoint();
            if (center) {
              const newMarker = createMarker(center);
              setMarkers([...markers, newMarker]);
            }
            break;
          }
          case "addMarker": {
            const position = params as Point;
            const newMarker = createMarker(position);
            setMarkers([...markers, newMarker]);
            break;
          }
          case "removeMarker": {
            const markerId = params as string;
            setMarkers(markers.filter((m) => m.id !== markerId));
            break;
          }
          case "clearMarkers":
            setMarkers([]);
            setClearingMode(false);
            break;
          case "undoMarker":
            // Remove the most recently placed marker (last in array)
            if (markers.length > 0) {
              const newMarkers = [...markers];
              newMarkers.pop();
              setMarkers(newMarkers);
            }
            break;
          // Line actions for measure tool
          case "selectLine":
            setSelectedLine(params as number);
            setMeasuring(false);
            break;
          case "selectPreviousLine":
            if (lines.length > 0) {
              const previous =
                selectedLine <= 0 ? lines.length - 1 : selectedLine - 1;
              setSelectedLine(previous);
            }
            break;
          case "selectNextLine":
            if (lines.length > 0) {
              const next =
                selectedLine + 1 >= lines.length ? 0 : selectedLine + 1;
              setSelectedLine(next);
            }
            break;
          case "deleteLine":
            if (selectedLine >= 0 && selectedLine < lines.length) {
              dispatchLines({ type: "remove", index: selectedLine });
              setSelectedLine(-1);
              setMeasuring(false);
            }
            break;
          case "updateLineDistance": {
            const { index, distance } = params as {
              index: number;
              distance: string;
            };
            dispatchLines({
              type: "update-distance",
              index,
              newDistance: distance,
            });
            break;
          }
          case "updateLineAngle": {
            const { index, angle } = params as { index: number; angle: string };
            dispatchLines({
              type: "update-angle",
              index,
              newAngle: angle,
            });
            break;
          }
          case "rotateLineToHorizontal": {
            if (selectedLine >= 0 && lines[selectedLine]) {
              const gridCenter = getCalibrationCenterPoint(
                width,
                height,
                unitOfMeasure,
              );
              const grainLine = createLine(
                gridCenter,
                { x: gridCenter.x + 1, y: gridCenter.y },
                unitOfMeasure,
              );
              const matLine = transformLine(
                lines[selectedLine],
                localTransform,
              );
              transformer.align(matLine, grainLine);
              setMeasuring(false);
            }
            break;
          }
          case "rotateAndCenterPrevious": {
            if (lines.length > 0) {
              const previous =
                selectedLine <= 0 ? lines.length - 1 : selectedLine - 1;
              setSelectedLine(previous);
              const gridCenter = getCalibrationCenterPoint(
                width,
                height,
                unitOfMeasure,
              );
              const grainLine = createLine(
                gridCenter,
                { x: gridCenter.x + 1, y: gridCenter.y },
                unitOfMeasure,
              );
              const matLine = transformLine(lines[previous], localTransform);
              transformer.align(matLine, grainLine);
              setMeasuring(false);
            }
            break;
          }
          case "rotateAndCenterNext": {
            if (lines.length > 0) {
              const next =
                selectedLine + 1 >= lines.length ? 0 : selectedLine + 1;
              setSelectedLine(next);
              const gridCenter = getCalibrationCenterPoint(
                width,
                height,
                unitOfMeasure,
              );
              const grainLine = createLine(
                gridCenter,
                { x: gridCenter.x + 1, y: gridCenter.y },
                unitOfMeasure,
              );
              const matLine = transformLine(lines[next], localTransform);
              transformer.align(matLine, grainLine);
              setMeasuring(false);
            }
            break;
          }
          case "flipAlongLine": {
            if (selectedLine >= 0 && lines[selectedLine]) {
              const matLine = transformLine(
                lines[selectedLine],
                localTransform,
              );
              transformer.flipAlong(matLine);
              setMeasuring(false);
            }
            break;
          }
          case "translateAlongLine": {
            if (selectedLine >= 0 && lines[selectedLine]) {
              const matLine = transformLine(
                lines[selectedLine],
                localTransform,
              );
              transformer.translate(
                subtract(matLine.points[1], matLine.points[0]),
              );
              // Swap the line endpoints after translate
              const line = lines[selectedLine];
              dispatchLines({
                type: "update-both-points",
                index: selectedLine,
                newP0: line.points[1],
                newP1: line.points[0],
              });
              setMeasuring(false);
            }
            break;
          }
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
      clearAppData,
      buildNoneCalibrationPoints,
      buildModerateCalibrationPoints,
      buildNoneCalibrationPointsForSize,
      buildModerateCalibrationPointsForSize,
      buildExtremeCalibrationPoints,
      buildExtremeCalibrationPointsForSize,
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
      applyPatternScale,
      getCalibrationCenterScreenAnchor,
      calculateCalibrationCenterPoint,
      markers,
      setMarkers,
      markingMode,
      setMarkingMode,
      clearingMode,
      setClearingMode,
      calculateViewportBounds,
      lines,
      dispatchLines,
      selectedLine,
      setSelectedLine,
      forcePdfRerender,
    ],
  );

  const { sendStateSync } = useBroadcastChannel(handleMessage);

  // Use a ref to hold the latest buildState function so we can call it from intervals
  // without causing the intervals to be recreated when buildState changes
  const buildStateRef = useRef(buildState);
  useEffect(() => {
    buildStateRef.current = buildState;
  }, [buildState]);

  // Track if state has changed since last sync
  const stateVersionRef = useRef(0);
  const lastSyncedVersionRef = useRef(0);

  // Increment version whenever buildState changes (indicates state changed)
  useEffect(() => {
    stateVersionRef.current += 1;
  }, [buildState]);

  // Send an immediate sync when preview loading starts so the control panel sees
  // the loading state before the 150ms throttle interval fires
  useEffect(() => {
    if (isPreviewLoading) {
      sendStateSync(buildStateRef.current());
    }
  }, [isPreviewLoading, sendStateSync]);

  // Throttled sync - send updates at most every 150ms, only when state has changed
  // This provides responsive updates without overwhelming the channel
  useEffect(() => {
    const interval = setInterval(() => {
      // Sync if: explicitly requested OR state has changed since last sync
      if (
        syncRequestedRef.current ||
        stateVersionRef.current !== lastSyncedVersionRef.current
      ) {
        syncRequestedRef.current = false;
        lastSyncedVersionRef.current = stateVersionRef.current;
        sendStateSync(buildStateRef.current());
      }
    }, 150);
    return () => clearInterval(interval);
  }, [sendStateSync]);

  // Send initial sync on mount
  useEffect(() => {
    // Small delay to ensure channel is ready
    const timeout = setTimeout(() => {
      sendStateSync(buildStateRef.current());
    }, 100);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // This component doesn't render anything - it just handles communication
  return null;
}
