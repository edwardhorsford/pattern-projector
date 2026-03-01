"use client";

import { Matrix, inverse } from "ml-matrix";
import React, {
  ChangeEvent,
  WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { FullScreen, useFullScreenHandle } from "react-full-screen";

import CalibrationCanvas from "@/_components/canvases/calibration-canvas";
import Draggable from "@/_components/draggable";
import Header from "@/_components/header";
import {
  RestoreTransforms,
  checkIsConcave,
  getCalibrationCenterPoint,
  getPerspectiveTransformFromPoints,
  transformPoint,
} from "@/_lib/geometry";
import isValidFile from "@/_lib/is-valid-file";
import removeNonDigits from "@/_lib/remove-non-digits";
import {
  DisplaySettings,
  getDefaultDisplaySettings,
  isDarkTheme,
  isColourTheme,
  applyBrightness,
  secondaryColor,
  strokeColor,
  themeRecolourFilter,
  Theme,
} from "@/_lib/display-settings";
import { getPtDensity, Unit } from "@/_lib/unit";
import { visible } from "@/_components/theme/css-functions";
import { useTranslations } from "next-intl";
import MeasureCanvas from "@/_components/canvases/measure-canvas";
import {
  getDefaultMenuStates,
  MenuPosition,
  MenuStates,
} from "@/_lib/menu-states";
import MovementPad from "@/_components/movement-pad";
import pointsReducer from "@/_reducers/pointsReducer";
import Filters from "@/_components/filters";
import CalibrationContext, {
  getCalibrationContext,
  getIsInvalidatedCalibrationContext,
  getIsInvalidatedCalibrationContextWithPointerEvent,
  logCalibrationContextDifferences,
} from "@/_lib/calibration-context";
import WarningIcon from "@/_icons/warning-icon";
import PdfViewer from "@/_components/pdf-viewer";
import { Transformable } from "@/_hooks/use-transform-context";
import OverlayCanvas from "@/_components/canvases/overlay-canvas";
import stitchSettingsReducer from "@/_reducers/stitchSettingsReducer";
import {
  LineDirection,
  StitchSettings,
} from "@/_lib/interfaces/stitch-settings";
import { IconButton } from "@/_components/buttons/icon-button";
import FullScreenExitIcon from "@/_icons/full-screen-exit-icon";
import FullScreenIcon from "@/_icons/full-screen-icon";
import { Layers } from "@/_lib/layers";
import useLayers from "@/_hooks/use-layers";
import ExpandMoreIcon from "@/_icons/expand-more-icon";
import ExpandLessIcon from "@/_icons/expand-less-icon";
import { LoadStatusEnum } from "@/_lib/load-status-enum";
import LoadingSpinner from "@/_icons/loading-spinner";
import TroubleshootingButton from "@/_components/troubleshooting-button";
import { ButtonColor } from "@/_components/theme/colors";
import MailModal from "@/_components/mail-modal";
import SideMenu from "@/_components/menus/side-menu";
import PatternScaleReducer from "@/_reducers/patternScaleReducer";
import Modal from "@/_components/modal/modal";
import { ModalTitle } from "@/_components/modal/modal-title";
import ModalContent from "@/_components/modal/modal-content";
import { ModalText } from "@/_components/modal/modal-text";
import { ControlPanelBridge } from "@/_components/control-panel-bridge";
import { ModalActions } from "@/_components/modal/modal-actions";
import { Button } from "@/_components/buttons/button";
import { erosionFilter } from "@/_lib/erode";
import SvgViewer from "@/_components/svg-viewer";
import { toggleFullScreen } from "@/_lib/full-screen";
import { usePdfThumbnail } from "@/_hooks/use-pdf-thumbnail";
import { Marker } from "@/_lib/marker";
import MarkerCanvas from "@/_components/canvases/marker-canvas";
import linesReducer from "@/_reducers/linesReducer";

const defaultStitchSettings: StitchSettings = {
  key: "stitchSettings:default",
  lineCount: 1,
  edgeInsets: { horizontal: 0, vertical: 0 },
  pageRange: "1-",
  lineDirection: LineDirection.Column,
};

type ProjectScaleDetail =
  | { type: "delta"; delta: number; anchor: { x: number; y: number } }
  | { type: "set"; scale: number; anchor: { x: number; y: number } };

export default function Page() {
  // Default dimensions should be available on most cutting mats and large enough to get an accurate calibration
  const defaultWidthDimensionValue = "60";
  const defaultHeightDimensionValue = "40";
  const maxDimensionValue = 1000; // Prevents crashing from excessive grid lines #410

  const maxPoints = 4; // One point per vertex in rectangle

  const fullScreenHandle = useFullScreenHandle();

  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>(
    getDefaultDisplaySettings(),
  );
  const [calibrationValidated, setCalibrationValidated] =
    useState<boolean>(false);
  const [widthInput, setWidthInput] = useState(defaultWidthDimensionValue);
  const [heightInput, setHeightInput] = useState(defaultHeightDimensionValue);
  const width = Number(widthInput) > 0 ? Number(widthInput) : 1;
  const height = Number(heightInput) > 0 ? Number(heightInput) : 1;
  const [isCalibrating, setIsCalibrating] = useState(true);
  const [fileLoadStatus, setFileLoadStatus] = useState<LoadStatusEnum>(
    LoadStatusEnum.DEFAULT,
  );
  const [lineThicknessStatus, setLineThicknessStatus] =
    useState<LoadStatusEnum>(LoadStatusEnum.DEFAULT);
  const [perspective, setPerspective] = useState<Matrix>(Matrix.identity(3, 3));
  const [file, setFile] = useState<File | null>(null);
  const [calibrationTransform, setCalibrationTransform] = useState<Matrix>(
    Matrix.identity(3, 3),
  );
  const [restoreTransforms, setRestoreTransforms] =
    useState<RestoreTransforms | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [unitOfMeasure, setUnitOfMeasure] = useState<Unit>(Unit.CM);
  const [layoutWidth, setLayoutWidth] = useState<number>(0);
  const [layoutHeight, setLayoutHeight] = useState<number>(0);
  const [lineThickness, setLineThickness] = useState<number>(0);
  const [measuring, setMeasuring] = useState<boolean>(false);
  const [magnifying, setMagnifying] = useState<boolean>(false);
  const [zoomedOut, setZoomedOut] = useState<boolean>(false);
  const [menusHidden, setMenusHidden] = useState<boolean>(false);
  const [isIdle, setIsIdle] = useState(false);
  const [menuStates, setMenuStates] = useState<MenuStates>(
    getDefaultMenuStates(),
  );
  const [showingMovePad, setShowingMovePad] = useState(false);
  const [corners, setCorners] = useState<Set<number>>(new Set([0]));
  const [showCalibrationAlert, setShowCalibrationAlert] = useState(false);
  const [fullScreenTooltipVisible, setFullScreenTooltipVisible] =
    useState(true);
  const [buttonColor, setButtonColor] = useState<ButtonColor>(
    ButtonColor.SECONDARY,
  );
  const [mailOpen, setMailOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<null | string>(null);

  // Markers for "mark complete" feature - positions in pattern space
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [markingMode, setMarkingMode] = useState<boolean>(false);
  const [clearingMode, setClearingMode] = useState<boolean>(false);

  // Ref for file input to allow control panel to trigger file open
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [points, dispatch] = useReducer(pointsReducer, []);
  const [stitchSettings, dispatchStitchSettings] = useReducer(
    stitchSettingsReducer,
    defaultStitchSettings,
  );
  const [lines, dispatchLines] = useReducer(linesReducer, []);
  const [selectedLine, setSelectedLine] = useState<number>(-1);
  // Incremented to force PdfViewer to remount and re-render all pages from scratch
  const [pdfRenderKey, setPdfRenderKey] = useState(0);
  const [showHighResOverlay, setShowHighResOverlay] = useState(true);
  const [debugTintHighRes, setDebugTintHighRes] = useState(false);
  const { layers, dispatchLayersAction } = useLayers(file?.name ?? "default");
  const setLayers = useCallback(
    (l: Layers) => dispatchLayersAction({ type: "set-layers", layers: l }),
    [dispatchLayersAction],
  );
  const [patternScale, dispatchPatternScaleAction] = useReducer(
    PatternScaleReducer,
    "1.00",
  );
  const patternScaleFactor =
    Number(patternScale) === 0 ? 1 : Number(patternScale);

  // State for preview thumbnail
  const [showPreviewImage, setShowPreviewImage] = useState(true);
  const { thumbnail: pdfThumbnail, isLoading: isPreviewLoading } =
    usePdfThumbnail(
      file?.type === "application/pdf" ? file : null,
      pageCount,
      stitchSettings,
      lineThickness,
      showPreviewImage && !isCalibrating,
      undefined,
      pdfRenderKey,
    );

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const gestureScaleRef = useRef(1);
  const controlKeyDownRef = useRef(false);
  const metaKeyDownRef = useRef(false);
  const lastPointerScreenRef = useRef({
    x: 0,
    y: 0,
  });

  const t = useTranslations("Header");
  const g = useTranslations("General");
  const tPdf = useTranslations("PdfViewer");

  const IDLE_TIMEOUT = 8000;

  const isRecolour = isColourTheme(displaySettings.theme);

  const recolourHex = isRecolour
    ? applyBrightness(
        strokeColor(displaySettings.theme),
        displaySettings.brightness,
      )
    : undefined;

  // Memoised so downstream components (e.g. PdfViewer via React.memo) don't get
  // a new object reference on every parent render, avoiding unnecessary re-renders.
  const calibrationCenter = useMemo(
    () => getCalibrationCenterPoint(width, height, unitOfMeasure),
    [width, height, unitOfMeasure],
  );

  const svgStyle = {
    filter: filter(
      magnifying,
      lineThickness,
      displaySettings.theme,
      isRecolour,
    ),
  };

  // Set erosions when not magnifying so the user can see text/lines more clearly when magnifying
  function filter(
    magnifying: boolean,
    lineThickness: number,
    theme: Theme,
    useRecolour: boolean = false,
  ) {
    // When recolouring, the container theme filter is "none" — the recolour
    // SVG filter applied on the canvas/element handles inversion + colouring.
    const t = useRecolour ? "none" : themeRecolourFilter(theme);
    const thicken = erosionFilter(magnifying ? 0 : lineThickness, useRecolour);
    // Add contrast after erosion to clean up grey anti-aliased edges before inverting
    const contrastBoost =
      isDarkTheme(theme) && thicken !== "none" ? "contrast(2)" : "";
    if (thicken == "none") {
      return t;
    }
    if (t == "none") {
      return thicken;
    }
    return `${thicken} ${contrastBoost} ${t}`.trim().replace(/\s+/g, " ");
  }

  // Manage the timeout used for hiding menus when the user hasn't interacted with the site for the specified timeout
  function resetIdle() {
    setIsIdle(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setIsIdle(true);
    }, IDLE_TIMEOUT);
  }

  // Create a default calibration grid that fits within the viewport with a bit of a border
  const getDefaultPoints = useCallback(() => {
    const { innerWidth, innerHeight } = window;
    // Use the currently selected calibration dimensions to define the target aspect ratio.
    const targetWidth = width > 0 ? width : 1;
    const targetHeight = height > 0 ? height : 1;
    const targetAspectRatio = targetWidth / targetHeight;

    // Fit the default grid inside 70% of the viewport so there is always a visible margin.
    const maxGridWidth = innerWidth * 0.7;
    const maxGridHeight = innerHeight * 0.7;

    // Start by fitting width-first, then clamp by height if needed to preserve aspect ratio.
    let gridWidth = maxGridWidth;
    let gridHeight = gridWidth / targetAspectRatio;

    if (gridHeight > maxGridHeight) {
      gridHeight = maxGridHeight;
      gridWidth = gridHeight * targetAspectRatio;
    }

    // Center the default rectangle in the viewport.
    const minX = (innerWidth - gridWidth) * 0.5;
    const minY = (innerHeight - gridHeight) * 0.5;
    const maxX = minX + gridWidth;
    const maxY = minY + gridHeight;

    return [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
  }, [width, height]);

  // Merge new settings (i.e. width x height, theme, overlays) with settings from localStorage
  function updateLocalSettings(newSettings: {}) {
    const settingString = localStorage.getItem("canvasSettings");
    let currSettings = {};
    if (settingString) {
      try {
        currSettings = JSON.parse(settingString);
      } catch (e) {
        currSettings = {};
      }
    }
    const merged = Object.assign({}, currSettings, newSettings);
    localStorage.setItem("canvasSettings", JSON.stringify(merged));
  }

  // CALLBACKS

  // Get the calibration and perspective transform matrices from the user's calibration grid points, width x height, and unit of measure.
  const calibrationCallback = useCallback(() => {
    if (points.length === maxPoints) {
      try {
        const m = getPerspectiveTransformFromPoints(
          points,
          width,
          height,
          getPtDensity(unitOfMeasure),
          false,
        );

        setCalibrationTransform(m);
        setPerspective(inverse(m));
      } catch (e) {
        setCalibrationTransform(Matrix.identity(3, 3));
        setPerspective(Matrix.identity(3, 3));
        dispatch({ type: "set", points: getDefaultPoints() }); // Fixes #363: on Chrome sometimes the points are set as zeros in localStorage
      }
    }
  }, [points, width, height, unitOfMeasure, getDefaultPoints]);

  // Prevent the user from zooming
  const noZoomRefCallback = useCallback((element: HTMLElement | null) => {
    if (element === null) {
      return;
    }
    element.addEventListener("wheel", (e) => e.ctrlKey && e.preventDefault(), {
      passive: false,
    });
  }, []);

  const getCalibrationCenterScreenAnchor = useCallback(() => {
    const calibrationCenter = getCalibrationCenterPoint(
      width,
      height,
      unitOfMeasure,
    );
    return transformPoint(calibrationCenter, calibrationTransform);
  }, [width, height, unitOfMeasure, calibrationTransform]);

  // Intercept browser keyboard zoom while projecting and map it to pattern scale
  const handleProjectZoomShortcut = useCallback(
    (event: KeyboardEvent) => {
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

      if (!isZoomIn && !isZoomOut && !isReset) {
        return;
      }

      event.preventDefault();

      if (isCalibrating) {
        return;
      }

      const anchor = getCalibrationCenterScreenAnchor();

      if (isZoomIn) {
        window.dispatchEvent(
          new CustomEvent<ProjectScaleDetail>("project-scale", {
            detail: { type: "delta", delta: 0.1, anchor },
          }),
        );
      } else if (isZoomOut) {
        window.dispatchEvent(
          new CustomEvent<ProjectScaleDetail>("project-scale", {
            detail: { type: "delta", delta: -0.1, anchor },
          }),
        );
      } else {
        window.dispatchEvent(
          new CustomEvent<ProjectScaleDetail>("project-scale", {
            detail: { type: "set", scale: 1, anchor },
          }),
        );
      }
    },
    [isCalibrating, getCalibrationCenterScreenAnchor],
  );

  const handleProjectPinchZoomDelta = useCallback(
    (
      deltaY: number,
      modifierKeyPressed: boolean,
      anchor: { x: number; y: number },
      preventDefault: () => void,
    ) => {
      const modifierPressed =
        modifierKeyPressed ||
        controlKeyDownRef.current ||
        metaKeyDownRef.current;

      if (isCalibrating || !modifierPressed) {
        if (modifierPressed) {
          preventDefault();
        }
        return;
      }

      preventDefault();

      const direction = Math.sign(deltaY);
      if (direction === 0) {
        return;
      }

      const steps = Math.max(1, Math.round(Math.abs(deltaY) / 80));

      window.dispatchEvent(
        new CustomEvent<ProjectScaleDetail>("project-scale", {
          detail: {
            type: "delta",
            delta: -direction * 0.1 * steps,
            anchor,
          },
        }),
      );
    },
    [isCalibrating],
  );

  const handleProjectPinchZoomCapture = useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      const anchor = {
        x:
          event.clientX > 0
            ? event.clientX
            : getCalibrationCenterScreenAnchor().x,
        y:
          event.clientY > 0
            ? event.clientY
            : getCalibrationCenterScreenAnchor().y,
      };

      handleProjectPinchZoomDelta(
        event.deltaY,
        event.ctrlKey || event.metaKey,
        anchor,
        () => event.preventDefault(),
      );
    },
    [handleProjectPinchZoomDelta, getCalibrationCenterScreenAnchor],
  );

  const handleProjectGestureStart = useCallback(
    (event: Event) => {
      event.preventDefault();

      if (isCalibrating) {
        return;
      }

      const scale = (event as Event & { scale?: number }).scale;
      gestureScaleRef.current = scale ?? 1;
    },
    [isCalibrating],
  );

  const handleProjectGestureChange = useCallback(
    (event: Event) => {
      event.preventDefault();

      if (isCalibrating) {
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

      const gestureEvent = event as Event & {
        clientX?: number;
        clientY?: number;
      };

      const anchor = {
        x:
          (gestureEvent.clientX ?? 0) > 0
            ? (gestureEvent.clientX as number)
            : getCalibrationCenterScreenAnchor().x,
        y:
          (gestureEvent.clientY ?? 0) > 0
            ? (gestureEvent.clientY as number)
            : getCalibrationCenterScreenAnchor().y,
      };

      window.dispatchEvent(
        new CustomEvent<ProjectScaleDetail>("project-scale", {
          detail: {
            type: "delta",
            delta: (diff > 0 ? 0.1 : -0.1) * steps,
            anchor,
          },
        }),
      );
    },
    [isCalibrating, getCalibrationCenterScreenAnchor],
  );

  const handleProjectGestureEnd = useCallback(() => {
    gestureScaleRef.current = 1;
  }, []);

  // If possible, stop the device from going to sleep
  const requestWakeLock = useCallback(async () => {
    if ("wakeLock" in navigator) {
      try {
        await navigator.wakeLock.request("screen");
      } catch (e) {}
    }
  }, []);

  // HANDLERS

  // Save valid calibration grid height in localStorage
  function handleHeightChange(e: ChangeEvent<HTMLInputElement>) {
    const h = removeNonDigits(e.target.value, heightInput, maxDimensionValue);
    setHeightInput(h);
    updateLocalSettings({ height: h });
  }

  // Save valid calibration grid width in localStorage
  function handleWidthChange(e: ChangeEvent<HTMLInputElement>) {
    const w = removeNonDigits(e.target.value, widthInput, maxDimensionValue);
    setWidthInput(w);
    updateLocalSettings({ width: w });
  }

  // Set new file; reset file based state; and if available, load file based state from localStorage
  function handleFileChange(e: ChangeEvent<HTMLInputElement>): void {
    const { files } = e.target;

    if (files && files[0] && isValidFile(files[0])) {
      setFile(files[0]);
      setFileLoadStatus(LoadStatusEnum.LOADING);
      setRestoreTransforms(null);
      setZoomedOut(false);
      setMagnifying(false);
      setMeasuring(false);
      setPageCount(0);
      setLayers({});
      dispatchPatternScaleAction({ type: "set", scale: "1.00" });
      const lineThicknessString = localStorage.getItem(
        `lineThickness:${files[0].name}`,
      );
      if (lineThicknessString !== null) {
        setLineThickness(Number(lineThicknessString));
      } else {
        setLineThickness(0);
      }

      const key = `stitchSettings:${files[0].name ?? "default"}`;
      const stitchSettingsString = localStorage.getItem(key);
      if (stitchSettingsString !== null) {
        const stitchSettings = JSON.parse(stitchSettingsString);
        if (!stitchSettings.lineCount) {
          // Old naming
          stitchSettings.lineCount = stitchSettings.columnCount;
        }
        if (!stitchSettings.lineDirection) {
          // For people who saved stitch settings before Line Direction was an option
          stitchSettings.lineDirection = LineDirection.Column;
        }
        dispatchStitchSettings({ type: "set", stitchSettings });
      } else {
        dispatchStitchSettings({
          type: "set",
          stitchSettings: {
            ...defaultStitchSettings,
            key,
          },
        });
      }

      calibrationCallback();
    }

    // If the user calibrated in full screen, try to go back into full screen after opening the file: some browsers pop users out of full screen when selecting a file
    const expectedContext = localStorage.getItem("calibrationContext");
    if (expectedContext !== null) {
      const expected = JSON.parse(expectedContext) as CalibrationContext;
      try {
        if (expected.fullScreen) {
          fullScreenHandle.enter();
        }
      } catch (e) {}
    }
  }

  function handlePointerDown(e: React.PointerEvent) {
    lastPointerScreenRef.current = { x: e.clientX, y: e.clientY };
    resetIdle();

    // Subtle reminder to enter full screen when calibrating
    if (fullScreenTooltipVisible) {
      setFullScreenTooltipVisible(false);
    }

    // Check if the calibration context (e.g. viewport location, device pixel ratio, etc.) has changed since the last calibration
    // Used to prompt the user if there has been a context change so they can verify that the calibration is still accurate
    if (calibrationValidated) {
      const expectedContext = localStorage.getItem("calibrationContext");
      if (expectedContext === null) {
        setCalibrationValidated(false);
      } else {
        const expected = JSON.parse(expectedContext) as CalibrationContext;
        if (
          getIsInvalidatedCalibrationContextWithPointerEvent(
            expected,
            e,
            fullScreenHandle.active,
          )
        ) {
          logCalibrationContextDifferences(expected, fullScreenHandle.active);
          setCalibrationValidated(false);
        }
      }
    }

    setMenusHidden(false);
  }

  function handlePointerMove(e: React.PointerEvent) {
    lastPointerScreenRef.current = { x: e.clientX, y: e.clientY };
    // Chromebook triggers move after menu hides #268
    if (e.movementX === 0 && e.movementY === 0) {
      return;
    }

    // Show menus when the user interacts with the app
    resetIdle();
    setMenusHidden(false);
  }

  // EFFECTS

  // Allow the user to open the file from their file browser, e.g., "Open With"
  useEffect(() => {
    requestWakeLock();
    if ("launchQueue" in window) {
      window.launchQueue.setConsumer(
        async (launchParams: { files: [FileSystemHandle] }) => {
          for (const handle of launchParams.files) {
            if (handle.kind == "file") {
              const file = await (handle as FileSystemFileHandle).getFile();
              setFile(file);
              return;
            }
          }
        },
      );
    }
  });

  // Remove buy me a coffee button when calibrating and projecting
  useEffect(() => {
    const element = document.getElementById("bmc-wbtn");
    if (element) {
      element.style.display = "none";
    }
  }, []);

  // Set calibration and perspective transforms
  useEffect(() => {
    calibrationCallback();
  }, [points, width, height, unitOfMeasure, calibrationCallback]);

  // Clear markers when the file changes (same pattern as line tool in MeasureCanvas)
  const previousFileKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const currentFileKey = file
      ? `${file.name}:${file.size}:${file.lastModified}`
      : null;
    if (previousFileKeyRef.current === null) {
      previousFileKeyRef.current = currentFileKey;
      return;
    }
    if (previousFileKeyRef.current !== currentFileKey) {
      setMarkers([]);
    }
    previousFileKeyRef.current = currentFileKey;
  }, [file]);

  useEffect(() => {
    window.addEventListener("keydown", handleProjectZoomShortcut);
    return () => {
      window.removeEventListener("keydown", handleProjectZoomShortcut);
    };
  }, [handleProjectZoomShortcut]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Control") {
        controlKeyDownRef.current = true;
      }
      if (event.key === "Meta") {
        metaKeyDownRef.current = true;
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
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

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    window.addEventListener("gesturestart", handleProjectGestureStart, {
      passive: false,
    });
    window.addEventListener("gesturechange", handleProjectGestureChange, {
      passive: false,
    });
    window.addEventListener("gestureend", handleProjectGestureEnd);

    return () => {
      window.removeEventListener("gesturestart", handleProjectGestureStart);
      window.removeEventListener("gesturechange", handleProjectGestureChange);
      window.removeEventListener("gestureend", handleProjectGestureEnd);
    };
  }, [
    handleProjectGestureChange,
    handleProjectGestureEnd,
    handleProjectGestureStart,
  ]);

  // Load data from localStorage
  useEffect(() => {
    const localPoints = localStorage.getItem("points");
    if (localPoints !== null) {
      dispatch({ type: "set", points: JSON.parse(localPoints) });
    } else {
      const { innerWidth, innerHeight } = window;
      const defaultAspectRatio =
        Number(defaultWidthDimensionValue) /
        Number(defaultHeightDimensionValue);
      const maxGridWidth = innerWidth * 0.7;
      const maxGridHeight = innerHeight * 0.7;

      let gridWidth = maxGridWidth;
      let gridHeight = gridWidth / defaultAspectRatio;
      if (gridHeight > maxGridHeight) {
        gridHeight = maxGridHeight;
        gridWidth = gridHeight * defaultAspectRatio;
      }

      const minX = (innerWidth - gridWidth) * 0.5;
      const minY = (innerHeight - gridHeight) * 0.5;

      dispatch({
        type: "set",
        points: [
          { x: minX, y: minY },
          { x: minX + gridWidth, y: minY },
          { x: minX + gridWidth, y: minY + gridHeight },
          { x: minX, y: minY + gridHeight },
        ],
      });
    }
    const localSettingString = localStorage.getItem("canvasSettings");
    if (localSettingString !== null) {
      const localSettings = JSON.parse(localSettingString);
      if (localSettings.height && Number(localSettings.height) > 0) {
        setHeightInput(localSettings.height);
      }
      if (localSettings.width && Number(localSettings.width) > 0) {
        setWidthInput(localSettings.width);
      }
      if (localSettings.unitOfMeasure) {
        setUnitOfMeasure(localSettings.unitOfMeasure);
      }
      const isTouchDevice = "ontouchstart" in window;
      if (localSettings.showingMovePad !== undefined) {
        setShowingMovePad(localSettings.showingMovePad);
      } else {
        setShowingMovePad(isTouchDevice);
      }

      const defaults = getDefaultDisplaySettings();
      setDisplaySettings({
        overlay: localSettings.overlay ?? defaults.overlay,
        theme: localSettings.theme ?? defaults.theme,
        brightness: localSettings.brightness ?? defaults.brightness,
      });
    }

    // Load menu position preference
    const savedMenuPosition = localStorage.getItem(
      "menuPosition",
    ) as MenuPosition | null;
    if (savedMenuPosition === "top" || savedMenuPosition === "bottom") {
      setMenuStates((prev) => ({ ...prev, menuPosition: savedMenuPosition }));
    }
  }, [defaultHeightDimensionValue, defaultWidthDimensionValue]);

  // Set button color style based on URL: blue for the beta site and gray for old site
  useEffect(() => {
    const s = window.location.host.split(".")[0];
    if (s.localeCompare("beta") === 0) {
      setButtonColor(ButtonColor.BLUE);
    }
    if (s.localeCompare("old") === 0) {
      setButtonColor(ButtonColor.GRAY);
    }
  }, []);

  // Show a helpful error message when there is a client side error
  useEffect(() => {
    window.addEventListener("error", (e) => {
      setErrorMessage(
        `${navigator.userAgent}|${e.filename}:${e.lineno}:${e.colno}:${e.message}`,
      );
      e.preventDefault();
    });
  }, []);

  // Show a calibration warning when the calibration context is different than what was calibrated in
  // Debounce to prevent brief flashes when validation temporarily fails
  useEffect(() => {
    const projectingWithInvalidContext =
      !isCalibrating && !calibrationValidated;

    if (projectingWithInvalidContext) {
      // Delay showing alert to avoid flashing on brief validation failures
      const timeout = setTimeout(() => {
        setShowCalibrationAlert(true);
      }, 300);
      return () => clearTimeout(timeout);
    } else {
      setShowCalibrationAlert(false);
    }
  }, [isCalibrating, calibrationValidated]);

  // Hide menus after a timeout as long ad they aren't calibrating, zoomed out, haven't loaded a file yet or are in the process of loading a file
  useEffect(() => {
    setMenusHidden(
      isIdle &&
        !isCalibrating &&
        !zoomedOut &&
        file !== null &&
        fileLoadStatus !== LoadStatusEnum.LOADING,
    );
  }, [isIdle, isCalibrating, zoomedOut, file, fileLoadStatus]);

  // Continually check the calibration context because the user could change the viewport size at any time and ruin their calibration
  useEffect(() => {
    const interval = setInterval(() => {
      const calibrationContext = localStorage.getItem("calibrationContext");
      if (calibrationContext === null) {
        if (calibrationValidated) {
          setCalibrationValidated(false);
        }
      } else {
        const expected = JSON.parse(calibrationContext) as CalibrationContext;
        const isInvalid = getIsInvalidatedCalibrationContext(
          expected,
          fullScreenHandle.active,
        );
        if (isInvalid === calibrationValidated) {
          setCalibrationValidated(!isInvalid);
        }
      }
    }, 500);
    return () => {
      clearInterval(interval);
    };
  }, [calibrationValidated, setCalibrationValidated, fullScreenHandle.active]);

  const dataUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file],
  );
  return (
    <main
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onWheelCapture={handleProjectPinchZoomCapture}
      onKeyDown={resetIdle}
      ref={noZoomRefCallback}
      className={`${menusHidden && "cursor-none"} ${isDarkTheme(displaySettings.theme) && "dark bg-black"} w-screen h-screen absolute overflow-hidden touch-none`}
    >
      {/* Hidden file input for control panel to trigger */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/svg+xml"
        onChange={handleFileChange}
        className="hidden"
      />
      <div className="bg-white dark:bg-black dark:text-white w-screen h-screen ">
        <FullScreen
          handle={fullScreenHandle}
          className="bg-white dark:bg-black w-screen h-screen"
        >
          {showCalibrationAlert ? (
            <div className="flex flex-col items-center gap-4 absolute left-1/4 top-1/2 -translate-y-1/2 w-1/2 bg-white dark:bg-black dark:text-white z-[150] p-4 rounded border-2 border-black dark:border-white pointer-events-none">
              <WarningIcon ariaLabel="warning" />
              <p>{t("calibrationAlert")}</p>
              <div className="flex items-center gap-2">
                <Button
                  className="pointer-events-auto"
                  onClick={() => setIsCalibrating(true)}
                >
                  {t("calibrate")}
                </Button>
                <Button
                  className="pointer-events-auto"
                  onClick={() => {
                    localStorage.setItem(
                      "calibrationContext",
                      JSON.stringify(
                        getCalibrationContext(fullScreenHandle.active),
                      ),
                    );
                    setCalibrationValidated(true);
                  }}
                >
                  Save window size and calibration
                </Button>
                <Button
                  className="flex items-center justify-center pointer-events-auto"
                  onClick={() => toggleFullScreen(fullScreenHandle)}
                >
                  <span className="mr-1 -mt-1.5 w-4 h-4">
                    {fullScreenHandle.active ? (
                      <FullScreenIcon ariaLabel={t("fullscreen")} />
                    ) : (
                      <FullScreenExitIcon ariaLabel={t("fullscreenExit")} />
                    )}
                  </span>
                  {fullScreenHandle.active
                    ? t("fullscreenExit")
                    : t("fullscreen")}
                </Button>
              </div>
              <p>{t("calibrationAlertContinue")}</p>
            </div>
          ) : null}
          <Modal open={errorMessage !== null}>
            <ModalTitle>{g("error")}</ModalTitle>
            <ModalContent>
              <ModalText>{errorMessage}</ModalText>
              <ModalActions>
                <Button onClick={() => setErrorMessage(null)}>
                  {g("close")}
                </Button>
              </ModalActions>
            </ModalContent>
          </Modal>
          {isCalibrating && (
            <CalibrationCanvas
              className={`absolute ${visible(isCalibrating)}`}
              points={points}
              dispatch={dispatch}
              width={width}
              height={height}
              isCalibrating={isCalibrating}
              unitOfMeasure={unitOfMeasure}
              displaySettings={displaySettings}
              corners={corners}
              setCorners={setCorners}
              fullScreenHandle={fullScreenHandle}
            />
          )}
          {isCalibrating && showingMovePad && (
            <MovementPad
              corners={corners}
              setCorners={setCorners}
              dispatch={dispatch}
              fullScreenHandle={fullScreenHandle}
              theme={displaySettings.theme}
            />
          )}

          <Transformable fileName={file?.name ?? "default"}>
            <ControlPanelBridge
              isCalibrating={isCalibrating}
              setIsCalibrating={setIsCalibrating}
              displaySettings={displaySettings}
              setDisplaySettings={(newSettings) => {
                setDisplaySettings(newSettings);
                if (newSettings) {
                  updateLocalSettings(newSettings);
                }
              }}
              zoomedOut={zoomedOut}
              setZoomedOut={setZoomedOut}
              magnifying={magnifying}
              setMagnifying={setMagnifying}
              measuring={measuring}
              setMeasuring={setMeasuring}
              file={file}
              setFile={setFile}
              lineThickness={lineThickness}
              setLineThickness={(newLineThickness) => {
                setLineThickness(newLineThickness);
                if (file) {
                  localStorage.setItem(
                    `lineThickness:${file.name}`,
                    String(newLineThickness),
                  );
                }
              }}
              pageCount={pageCount}
              patternScale={patternScale}
              dispatchPatternScaleAction={dispatchPatternScaleAction}
              menuStates={menuStates}
              setMenuStates={setMenuStates}
              widthInput={widthInput}
              heightInput={heightInput}
              handleWidthChange={handleWidthChange}
              handleHeightChange={handleHeightChange}
              unitOfMeasure={unitOfMeasure}
              setUnitOfMeasure={(newUnit) => {
                setUnitOfMeasure(newUnit);
                updateLocalSettings({ unitOfMeasure: newUnit });
              }}
              handleResetCalibration={() => {
                localStorage.setItem(
                  "calibrationContext",
                  JSON.stringify(
                    getCalibrationContext(fullScreenHandle.active),
                  ),
                );
                dispatch({ type: "set", points: getDefaultPoints() });
              }}
              fileInputRef={fileInputRef}
              width={width}
              height={height}
              layoutWidth={layoutWidth}
              layoutHeight={layoutHeight}
              getCalibrationCenterPoint={getCalibrationCenterPoint}
              layers={layers}
              dispatchLayerAction={dispatchLayersAction}
              stitchSettings={stitchSettings}
              dispatchStitchSettings={dispatchStitchSettings}
              showingMovePad={showingMovePad}
              setShowingMovePad={(show) => {
                setShowingMovePad(show);
                updateLocalSettings({ showingMovePad: show });
              }}
              points={points}
              corners={corners}
              setCorners={setCorners}
              dispatchPoints={dispatch}
              setCalibrationValidated={setCalibrationValidated}
              fullScreenActive={fullScreenHandle.active}
              perspective={perspective}
              calibrationTransform={calibrationTransform}
              restoreTransforms={restoreTransforms}
              setRestoreTransforms={setRestoreTransforms}
              pdfThumbnail={
                file?.type === "application/pdf" ? pdfThumbnail : dataUrl
              }
              isPreviewLoading={
                file?.type === "application/pdf" ? isPreviewLoading : false
              }
              showPreviewImage={showPreviewImage}
              setShowPreviewImage={setShowPreviewImage}
              fileLoadStatus={fileLoadStatus}
              lineThicknessStatus={lineThicknessStatus}
              markers={markers}
              setMarkers={setMarkers}
              markingMode={markingMode}
              setMarkingMode={setMarkingMode}
              clearingMode={clearingMode}
              setClearingMode={setClearingMode}
              lines={lines}
              dispatchLines={dispatchLines}
              selectedLine={selectedLine}
              setSelectedLine={setSelectedLine}
              forcePdfRerender={() => setPdfRenderKey((k) => k + 1)}
              showHighResOverlay={showHighResOverlay}
              setShowHighResOverlay={setShowHighResOverlay}
              debugTintHighRes={debugTintHighRes}
              setDebugTintHighRes={setDebugTintHighRes}
            />
            {!isCalibrating && (
              // Layer order (low -> high): image data (Draggable/PDF), overlays, markers, UI.
              <MeasureCanvas
                className={`relative z-0 ${visible(!isCalibrating)}`}
                perspective={perspective}
                calibrationTransform={calibrationTransform}
                unitOfMeasure={unitOfMeasure}
                measuring={measuring}
                setMeasuring={setMeasuring}
                file={file}
                gridCenter={calibrationCenter}
                zoomedOut={zoomedOut}
                magnifying={magnifying}
                menusHidden={menusHidden}
                menuStates={menuStates}
                isDarkTheme={isDarkTheme(displaySettings.theme)}
                lines={lines}
                dispatchLines={dispatchLines}
                selectedLine={selectedLine}
                setSelectedLine={setSelectedLine}
                patternScale={patternScaleFactor}
                accentColor={secondaryColor(displaySettings.theme)}
              >
                <Draggable
                  className={`absolute ${menusHidden && "!cursor-none"} `}
                  perspective={perspective}
                  isCalibrating={isCalibrating}
                  unitOfMeasure={unitOfMeasure}
                  calibrationTransform={calibrationTransform}
                  setCalibrationTransform={setCalibrationTransform}
                  setPerspective={setPerspective}
                  magnifying={magnifying}
                  setMagnifying={setMagnifying}
                  setRestoreTransforms={setRestoreTransforms}
                  restoreTransforms={restoreTransforms}
                  zoomedOut={zoomedOut}
                  setZoomedOut={setZoomedOut}
                  layoutWidth={layoutWidth}
                  layoutHeight={layoutHeight}
                  calibrationCenter={calibrationCenter}
                  patternScale={patternScaleFactor}
                  menuStates={menuStates}
                  file={file}
                  markingMode={markingMode}
                  setMarkingMode={setMarkingMode}
                  clearingMode={clearingMode}
                  setClearingMode={setClearingMode}
                  markers={markers}
                  setMarkers={setMarkers}
                >
                  {file === null || file.type === "application/pdf" ? (
                    <PdfViewer
                      file={file}
                      setPageCount={setPageCount}
                      pageCount={pageCount}
                      setLayers={setLayers}
                      layers={layers}
                      setLayoutWidth={setLayoutWidth}
                      setLayoutHeight={setLayoutHeight}
                      lineThickness={lineThickness}
                      stitchSettings={stitchSettings}
                      filter={
                        isColourTheme(displaySettings.theme)
                          ? "none"
                          : themeRecolourFilter(displaySettings.theme)
                      }
                      canvasBackground={
                        isDarkTheme(displaySettings.theme)
                          ? "#000000"
                          : "#ffffff"
                      }
                      recolourHex={recolourHex}
                      dispatchStitchSettings={dispatchStitchSettings}
                      setLineThicknessStatus={setLineThicknessStatus}
                      setFileLoadStatus={setFileLoadStatus}
                      magnifying={magnifying}
                      gridCenter={calibrationCenter}
                      patternScale={patternScaleFactor}
                      setMenuStates={setMenuStates}
                      renderVersion={pdfRenderKey}
                      perspective={perspective}
                      showHighResOverlay={showHighResOverlay}
                      debugTintHighRes={debugTintHighRes}
                    />
                  ) : (
                    <SvgViewer
                      dataUrl={dataUrl ?? ""}
                      setFileLoadStatus={setFileLoadStatus}
                      setLayoutWidth={setLayoutWidth}
                      setLayoutHeight={setLayoutHeight}
                      setPageCount={setPageCount}
                      layers={layers}
                      setLayers={setLayers}
                      svgStyle={svgStyle}
                      patternScale={patternScaleFactor}
                      setMenuStates={setMenuStates}
                      patternScaleFactor={patternScaleFactor}
                    />
                  )}
                </Draggable>
                <OverlayCanvas
                  className={`absolute top-0 z-20 pointer-events-none`}
                  points={points}
                  width={width}
                  height={height}
                  unitOfMeasure={unitOfMeasure}
                  displaySettings={displaySettings}
                  calibrationTransform={calibrationTransform}
                  zoomedOut={zoomedOut}
                  magnifying={magnifying}
                  restoreTransforms={restoreTransforms}
                  patternScale={String(patternScaleFactor)}
                />
                <MarkerCanvas
                  markers={markers}
                  calibrationTransform={calibrationTransform}
                  patternScale={patternScaleFactor}
                  unitOfMeasure={unitOfMeasure}
                  theme={displaySettings.theme}
                  className="z-30"
                />
              </MeasureCanvas>
            )}

            {/* Keep interactive UI above all transformed content and overlay layers. */}
            <menu
              className={`absolute z-40 w-screen ${visible(!menusHidden)} ${
                menuStates.menuPosition === "bottom"
                  ? menuStates.nav
                    ? "bottom-0"
                    : "-bottom-16"
                  : menuStates.nav
                    ? "top-0"
                    : "-top-16"
              } pointer-events-none flex ${menuStates.menuPosition === "bottom" ? "flex-col-reverse" : "flex-col"}`}
            >
              <menu className="pointer-events-auto">
                <Header
                  isCalibrating={isCalibrating}
                  setIsCalibrating={setIsCalibrating}
                  widthInput={widthInput}
                  heightInput={heightInput}
                  width={width}
                  height={height}
                  handleHeightChange={handleHeightChange}
                  handleWidthChange={handleWidthChange}
                  handleResetCalibration={() => {
                    localStorage.setItem(
                      "calibrationContext",
                      JSON.stringify(
                        getCalibrationContext(fullScreenHandle.active),
                      ),
                    );
                    dispatch({ type: "set", points: getDefaultPoints() });
                  }}
                  handleFileChange={handleFileChange}
                  fullScreenHandle={fullScreenHandle}
                  unitOfMeasure={unitOfMeasure}
                  setUnitOfMeasure={(newUnit) => {
                    setUnitOfMeasure(newUnit);
                    updateLocalSettings({ unitOfMeasure: newUnit });
                  }}
                  displaySettings={displaySettings}
                  setDisplaySettings={(newSettings) => {
                    setDisplaySettings(newSettings);
                    if (newSettings) {
                      updateLocalSettings(newSettings);
                    }
                  }}
                  layoutWidth={layoutWidth}
                  layoutHeight={layoutHeight}
                  lineThickness={lineThickness}
                  setLineThickness={(newLineThickness) => {
                    setLineThickness(newLineThickness);
                    if (file) {
                      localStorage.setItem(
                        `lineThickness:${file.name}`,
                        String(newLineThickness),
                      );
                    }
                  }}
                  setMenuStates={setMenuStates}
                  menuStates={menuStates}
                  measuring={measuring}
                  setMeasuring={setMeasuring}
                  showingMovePad={showingMovePad}
                  setShowingMovePad={(show) => {
                    setShowingMovePad(show);
                    updateLocalSettings({ showingMovePad: show });
                  }}
                  setCalibrationValidated={setCalibrationValidated}
                  fullScreenTooltipVisible={fullScreenTooltipVisible}
                  magnifying={magnifying}
                  setMagnifying={setMagnifying}
                  zoomedOut={zoomedOut}
                  setZoomedOut={setZoomedOut}
                  fileLoadStatus={fileLoadStatus}
                  lineThicknessStatus={lineThicknessStatus}
                  buttonColor={buttonColor}
                  mailOpen={mailOpen}
                  setMailOpen={setMailOpen}
                  invalidCalibration={checkIsConcave(points)}
                  file={file}
                />
                {isCalibrating && menuStates.nav && (
                  <TroubleshootingButton
                    isDarkTheme={isDarkTheme(displaySettings.theme)}
                  />
                )}
                <MailModal open={mailOpen} setOpen={setMailOpen} />
              </menu>

              {!isCalibrating && file !== null && (
                <SideMenu
                  menuStates={menuStates}
                  setMenuStates={setMenuStates}
                  pageCount={pageCount}
                  layers={layers}
                  dispatchLayersAction={dispatchLayersAction}
                  file={file}
                  stitchSettings={stitchSettings}
                  dispatchStitchSettings={dispatchStitchSettings}
                  patternScale={patternScale}
                  dispatchPatternScaleAction={dispatchPatternScaleAction}
                  onStepScale={(delta) => {
                    window.dispatchEvent(
                      new CustomEvent<ProjectScaleDetail>("project-scale", {
                        detail: {
                          type: "delta",
                          delta,
                          anchor: getCalibrationCenterScreenAnchor(),
                        },
                      }),
                    );
                  }}
                />
              )}
            </menu>
            <IconButton
              className={`${visible(!menusHidden)} z-40 !p-1 m-0 border-2 border-black dark:border-white absolute ${
                menuStates.menuPosition === "bottom"
                  ? menuStates.nav
                    ? "-bottom-16"
                    : "bottom-2"
                  : menuStates.nav
                    ? "-top-16"
                    : "top-2"
              } left-1/4 focus:ring-0`}
              onClick={() => setMenuStates({ ...menuStates, nav: true })}
            >
              {menuStates.menuPosition === "bottom" ? (
                <ExpandLessIcon ariaLabel={t("menuShow")} />
              ) : (
                <ExpandMoreIcon ariaLabel={t("menuShow")} />
              )}
            </IconButton>
            {!isCalibrating && fileLoadStatus === LoadStatusEnum.LOADING ? (
              <div
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: getCalibrationCenterScreenAnchor().x,
                  top: getCalibrationCenterScreenAnchor().y,
                }}
              >
                <LoadingSpinner height={100} width={100} />
              </div>
            ) : null}
            {!isCalibrating &&
            fileLoadStatus !== LoadStatusEnum.LOADING &&
            lineThicknessStatus === LoadStatusEnum.LOADING ? (
              <div
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: getCalibrationCenterScreenAnchor().x,
                  top: getCalibrationCenterScreenAnchor().y,
                }}
              >
                <LoadingSpinner height={80} width={80} />
              </div>
            ) : null}
            {!isCalibrating &&
            file === null &&
            fileLoadStatus !== LoadStatusEnum.LOADING ? (
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                <p className="text-2xl text-purple-600 dark:text-purple-400 bg-gray-500/40 px-8 py-6 rounded-lg whitespace-nowrap">
                  {tPdf("noData")}
                </p>
              </div>
            ) : null}
            {!isCalibrating && fileLoadStatus === LoadStatusEnum.FAILED ? (
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                <p className="text-2xl text-red-600 dark:text-red-400 bg-gray-500/40 px-8 py-6 rounded-lg whitespace-nowrap">
                  {tPdf("error")}
                </p>
              </div>
            ) : null}
          </Transformable>
        </FullScreen>
      </div>
      <Filters recolourHex={recolourHex} />
    </main>
  );
}
