"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  useBroadcastChannel,
  BroadcastMessage,
  ActionPayload,
  FileTransferPayload,
} from "@/_hooks/use-broadcast-channel";
import { useTransformerContext } from "@/_hooks/use-transform-context";
import { DisplaySettings, themes } from "@/_lib/display-settings";
import {
  MenuStates,
  SideMenuType,
  toggleSideMenuStates,
} from "@/_lib/menu-states";
import { Dispatch, SetStateAction, ChangeEvent, RefObject } from "react";
import { PatternScaleAction } from "@/_reducers/patternScaleReducer";
import { Layers } from "@/_lib/layers";
import {
  StitchSettings,
  LineDirection,
} from "@/_lib/interfaces/stitch-settings";
import { StitchSettingsAction } from "@/_reducers/stitchSettingsReducer";
import { LayerAction } from "@/_reducers/layersReducer";
import {
  getCalibrationContext,
} from "@/_lib/calibration-context";
import { PointAction } from "@/_reducers/pointsReducer";
import { Direction } from "@/_lib/direction";
import { Point } from "@/_lib/point";

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
}: ControlPanelBridgeProps) {
  const transformer = useTransformerContext();
  const syncRequestedRef = useRef(false);

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

  // Build current state object
  const buildState = useCallback(
    () => ({
      isCalibrating,
      displaySettings,
      zoomedOut,
      magnifying,
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
    }),
    [
      isCalibrating,
      displaySettings,
      zoomedOut,
      magnifying,
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
            transformer.translate(panOffset);
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
