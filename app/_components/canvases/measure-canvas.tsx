import {
  constrained,
  dist,
  distToLine,
  scale,
  transformPoint,
} from "@/_lib/geometry";
import { CSS_PIXELS_PER_INCH } from "@/_lib/pixels-per-inch";
import { Point } from "@/_lib/point";
import Matrix, { inverse } from "ml-matrix";
import React, {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { drawLine, drawArrow, drawCircle } from "@/_lib/drawing";
import { useTransformContext } from "@/_hooks/use-transform-context";

import { KeyCode } from "@/_lib/key-code";
import LineMenu from "@/_components/menus/line-menu";
import {
  LOUPE_DISPLAY_PX,
  LOUPE_GAP,
  LOUPE_POINT_EVENT,
  SCREEN_MARGIN,
} from "@/_components/pdf-loupe";
import { useKeyDown } from "@/_hooks/use-key-down";
import { useKeyUp } from "@/_hooks/use-key-up";
import useProgArrowKeyHandler from "@/_hooks/use-prog-arrow-key-handler";
import { Unit } from "@/_lib/unit";
import { measureEndSelectedRef } from "@/_lib/measure-end-selected";
import { MenuStates } from "@/_lib/menu-states";
import {
  Line,
  LinesAction,
  createLine,
  transformLine,
} from "@/_reducers/linesReducer";

export default function MeasureCanvas({
  perspective,
  calibrationTransform,
  unitOfMeasure,
  className,
  measuring,
  setMeasuring,
  file,
  gridCenter,
  zoomedOut,
  magnifying,
  magnifyTransform = null,
  menusHidden,
  menuStates,
  isDarkTheme,
  lines,
  dispatchLines,
  pushLinesSnapshot,
  selectedLine,
  setSelectedLine,
  patternScale,
  accentColor,
  children,
}: {
  perspective: Matrix;
  calibrationTransform: Matrix;
  unitOfMeasure: Unit;
  className?: string;
  measuring: boolean;
  setMeasuring: Dispatch<SetStateAction<boolean>>;
  file: File | null;
  gridCenter: Point;
  zoomedOut: boolean;
  magnifying: boolean;
  magnifyTransform?: Matrix | null;
  menusHidden: boolean;
  menuStates: MenuStates;
  isDarkTheme: boolean;
  lines: Line[];
  dispatchLines: Dispatch<LinesAction>;
  pushLinesSnapshot: () => void;
  selectedLine: number;
  setSelectedLine: Dispatch<SetStateAction<number>>;
  patternScale: number;
  accentColor: string;
  children: React.ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragOffset = useRef<Point | null>(null);
  const previousFileKey = useRef<string | null>(null);
  const draggingWholeLine = useRef<boolean>(false);
  const lineDragPatternStart = useRef<Point | null>(null);
  const lineDragInitialPoints = useRef<[Point, Point] | null>(null);
  // Tracks raw pointer client position during an endpoint drag so the Shift-release
  // handler can re-dispatch the unconstrained loupe position without waiting for
  // the next pointermove event.
  const lastDragClientRef = useRef<Point | null>(null);

  const [axisConstrained, setAxisConstrained] = useState<boolean>(false);
  const [hoveredEnd, setHoveredEnd] = useState<{
    lineIndex: number;
    endIndex: 0 | 1;
  } | null>(null);
  const [hoveredLineIndex, setHoveredLineIndex] = useState<number>(-1);
  const [isDraggingWholeLine, setIsDraggingWholeLine] =
    useState<boolean>(false);

  // Tracks the last-touched endpoint, enabling arrow-key nudging.
  const [selectedEnd, setSelectedEnd] = useState<{
    lineIndex: number;
    endIndex: 0 | 1;
  } | null>(null);

  // Timer used to keep the loupe visible for a few seconds after the last nudge/click.
  const loupeLingerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // True while a linger timer is running — prevents handlePointerMove's hover-null
  // dispatch from killing the loupe immediately after pointer up.
  const loupeLingerActiveRef = useRef(false);

  // Ref-based Tab handler so it always reads the latest state without re-registering the listener.
  const tabHandlerRef = useRef<() => void>(() => {});

  const transform = useTransformContext();

  const disablePointer =
    measuring ||
    dragOffset.current !== null ||
    hoveredEnd !== null ||
    hoveredLineIndex >= 0;

  // Use a consistent physical size for the touch area (1/2 inch).
  const TOUCH_AREA_INCHES = 0.5;
  const END_CIRCLE_RADIUS = CSS_PIXELS_PER_INCH * TOUCH_AREA_INCHES;
  const LINE_TOUCH_RADIUS = CSS_PIXELS_PER_INCH * 0.5; // A slightly larger area for the line itself

  /**
   * Fires a "loupe-point" custom event so PdfLoupe can render a magnified
   * inset centred on the given screen point. Pass null to hide the loupe.
   * The string literal must match LOUPE_POINT_EVENT in pdf-loupe.tsx.
   */
  const dispatchLoupePoint = (screenPoint: Point | null) => {
    document.dispatchEvent(
      new CustomEvent<Point | null>(LOUPE_POINT_EVENT, { detail: screenPoint }),
    );
  };

  /** Start (or restart) the loupe linger timer. Blocks hover-null dispatches. */
  const startLoupeLingerTimer = () => {
    loupeLingerActiveRef.current = true;
    if (loupeLingerTimerRef.current) clearTimeout(loupeLingerTimerRef.current);
    loupeLingerTimerRef.current = setTimeout(() => {
      dispatchLoupePoint(null);
      loupeLingerTimerRef.current = null;
      loupeLingerActiveRef.current = false;
    }, 2000);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (magnifying) {
      return;
    }
    const client = { x: e.clientX, y: e.clientY };
    const patternToCalibrated = transform.mmul(scale(patternScale));
    const patternToClient = calibrationTransform.mmul(patternToCalibrated);

    const transformScale = Math.sqrt(
      transform.get(0, 0) ** 2 + transform.get(0, 1) ** 2,
    );
    const scaledEndCircleRadius = END_CIRCLE_RADIUS / transformScale;
    const scaledLineTouchRadius = LINE_TOUCH_RADIUS / transformScale;

    let lineToSelect = -1;

    for (let i = 0; i < lines.length; i++) {
      const patternLine = lines[i];
      const clientLine = transformLine(patternLine, patternToClient);
      // Start dragging one end of the selected line?
      for (const end of [0, 1]) {
        const clientEnd = clientLine.points[end];
        const d = dist(clientEnd, client);
        if (d < scaledEndCircleRadius) {
          pushLinesSnapshot();
          setSelectedLine(i);
          dragOffset.current = {
            x: clientEnd.x - client.x,
            y: clientEnd.y - client.y,
          };
          if (end === 0) {
            // Swap to always drag the end.
            dispatchLines({
              type: "update-both-points",
              index: i,
              newP0: patternLine.points[1],
              newP1: patternLine.points[0],
            });
          }
          e.stopPropagation();
          draggingWholeLine.current = false;
          lineDragPatternStart.current = null;
          lineDragInitialPoints.current = null;
          setHoveredEnd({ lineIndex: i, endIndex: 1 });
          // Show the loupe immediately on click so the user can see the endpoint position.
          dispatchLoupePoint(clientEnd);
          startLoupeLingerTimer();
          return;
        }
      }

      const dToLine = distToLine(clientLine.points, client);
      if (dToLine < scaledLineTouchRadius) {
        lineToSelect = i;
      }
    }

    if (lineToSelect !== -1) {
      const patternLine = lines[lineToSelect];
      const pattern = transformPoint(client, inverse(patternToClient));
      setSelectedLine(lineToSelect);
      setHoveredLineIndex(lineToSelect);
      dragOffset.current = { x: 0, y: 0 };
      pushLinesSnapshot();
      draggingWholeLine.current = true;
      setIsDraggingWholeLine(true);
      lineDragPatternStart.current = pattern;
      lineDragInitialPoints.current = [
        { ...patternLine.points[0] },
        { ...patternLine.points[1] },
      ];
      setSelectedEnd(null);
      dispatchLoupePoint(null);
      e.stopPropagation();
      return;
    }

    // Nothing selected.
    setSelectedEnd(null);
    setSelectedLine(-1);
    dragOffset.current = null;

    if (!measuring) {
      return;
    }

    // Create a new line and start dragging its end.
    const pattern = transformPoint(client, inverse(patternToClient));
    pushLinesSnapshot();
    dispatchLines({
      type: "add",
      line: createLine(pattern, pattern, unitOfMeasure),
    });
    setSelectedLine(lines.length);
    dragOffset.current = {
      x: 0,
      y: 0,
    };
    dispatchLoupePoint(client);
    e.stopPropagation();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.buttons === 0 && dragOffset.current) {
      e.stopPropagation();
      // If the mouse button is released, end the drag.
      dragOffset.current = null;
      draggingWholeLine.current = false;
      setIsDraggingWholeLine(false);
      lineDragPatternStart.current = null;
      lineDragInitialPoints.current = null;
      dispatchLoupePoint(null);
      return;
    }

    // Not dragging — update endpoint hover state.
    if (!dragOffset.current) {
      if (magnifying) {
        setHoveredEnd(null);
        setHoveredLineIndex(-1);
        return;
      }
      const client = { x: e.clientX, y: e.clientY };
      const patternToCalibrated = transform.mmul(scale(patternScale));
      const patternToClient = calibrationTransform.mmul(patternToCalibrated);
      let newHoveredEnd: { lineIndex: number; endIndex: 0 | 1 } | null = null;
      let hoveredEndScreenPoint: Point | null = null;
      for (let i = 0; i < lines.length; i++) {
        const clientLine = transformLine(lines[i], patternToClient);
        for (const endIndex of [0, 1] as const) {
          if (dist(clientLine.points[endIndex], client) < END_CIRCLE_RADIUS) {
            newHoveredEnd = { lineIndex: i, endIndex };
            hoveredEndScreenPoint = clientLine.points[endIndex];
            break;
          }
        }
        if (newHoveredEnd) break;
      }
      setHoveredEnd(newHoveredEnd);
      // When measuring and not over an existing endpoint, show the loupe at
      // the cursor so the user can see where the new line's first point will land.
      const loupePoint = newHoveredEnd
        ? hoveredEndScreenPoint
        : measuring
          ? client
          : loupeLingerActiveRef.current
            ? undefined // linger active — don't override the post-drag loupe
            : null;
      if (loupePoint !== undefined) dispatchLoupePoint(loupePoint);

      // Check for line body hover (not near an endpoint).
      let newHoveredLine = -1;
      if (!newHoveredEnd) {
        for (let i = 0; i < lines.length; i++) {
          const clientLine = transformLine(lines[i], patternToClient);
          if (distToLine(clientLine.points, client) < LINE_TOUCH_RADIUS) {
            newHoveredLine = i;
            break;
          }
        }
      }
      setHoveredLineIndex(newHoveredLine);
    }

    // Dragging a line?
    if (
      selectedLine >= 0 &&
      selectedLine < lines.length &&
      dragOffset.current
    ) {
      e.stopPropagation();
      const client = { x: e.clientX, y: e.clientY };
      const patternToCalibrated = transform.mmul(scale(patternScale));
      const patternToClient = calibrationTransform.mmul(patternToCalibrated);

      if (
        draggingWholeLine.current &&
        lineDragPatternStart.current &&
        lineDragInitialPoints.current
      ) {
        // Move both endpoints by the pattern-space delta from the drag start.
        const currentPattern = transformPoint(client, inverse(patternToClient));
        const dx = currentPattern.x - lineDragPatternStart.current.x;
        const dy = currentPattern.y - lineDragPatternStart.current.y;
        dispatchLines({
          type: "update-both-points",
          index: selectedLine,
          newP0: {
            x: lineDragInitialPoints.current[0].x + dx,
            y: lineDragInitialPoints.current[0].y + dy,
          },
          newP1: {
            x: lineDragInitialPoints.current[1].x + dx,
            y: lineDragInitialPoints.current[1].y + dy,
          },
        });
      } else {
        // Dragging one endpoint.
        lastDragClientRef.current = client;
        const clientDestination = {
          x: client.x + dragOffset.current.x,
          y: client.y + dragOffset.current.y,
        };

        const matLine = transformLine(lines[selectedLine], patternToCalibrated);
        let matFinal = transformPoint(clientDestination, perspective);
        if (axisConstrained) {
          matFinal = constrained(matFinal, matLine.points[0]);
        }
        const patternDestination = transformPoint(
          matFinal,
          inverse(patternToCalibrated),
        );

        dispatchLines({
          type: "update-point",
          index: selectedLine,
          pointIndex: 1, // Always dragging the second point
          newPoint: patternDestination,
          isConstrained: axisConstrained,
        });
        // Dispatch the *actual* endpoint screen position (constrained when shift held).
        dispatchLoupePoint(
          transformPoint(
            patternDestination,
            calibrationTransform.mmul(patternToCalibrated),
          ),
        );
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!dragOffset.current) {
      return;
    }

    e.stopPropagation();

    if (
      draggingWholeLine.current &&
      lineDragPatternStart.current &&
      lineDragInitialPoints.current
    ) {
      // Finalise whole-line drag.
      const client = { x: e.clientX, y: e.clientY };
      const patternToCalibrated = transform.mmul(scale(patternScale));
      const patternToClient = calibrationTransform.mmul(patternToCalibrated);
      const currentPattern = transformPoint(client, inverse(patternToClient));
      const dx = currentPattern.x - lineDragPatternStart.current.x;
      const dy = currentPattern.y - lineDragPatternStart.current.y;
      dispatchLines({
        type: "update-both-points",
        index: selectedLine,
        newP0: {
          x: lineDragInitialPoints.current[0].x + dx,
          y: lineDragInitialPoints.current[0].y + dy,
        },
        newP1: {
          x: lineDragInitialPoints.current[1].x + dx,
          y: lineDragInitialPoints.current[1].y + dy,
        },
      });
      draggingWholeLine.current = false;
      setIsDraggingWholeLine(false);
      lineDragPatternStart.current = null;
      lineDragInitialPoints.current = null;
      dragOffset.current = null;
      dispatchLoupePoint(null);
      return;
    }

    const client = {
      x: e.clientX + dragOffset.current.x,
      y: e.clientY + dragOffset.current.y,
    };

    dragOffset.current = null;

    if (selectedLine < 0 || selectedLine >= lines.length) {
      return;
    }

    const patternToCalibrated = transform.mmul(scale(patternScale));
    const patternLine = lines[selectedLine];
    const patternAnchor = patternLine.points[0];
    const matAnchor = transformPoint(patternAnchor, patternToCalibrated);
    const destMat = transformPoint(client, perspective);
    let matFinal = destMat;
    if (axisConstrained) {
      matFinal = constrained(destMat, matAnchor);
    }
    // If it's too small, drop a reasonable size line instead.
    if (dist(matFinal, matAnchor) < CSS_PIXELS_PER_INCH / 16) {
      matFinal = { x: matAnchor.x + CSS_PIXELS_PER_INCH, y: matAnchor.y };
    }
    const patternFinal = transformPoint(matFinal, inverse(patternToCalibrated));
    if (!zoomedOut) {
      setMeasuring(false);
    }
    dispatchLines({
      type: "update-point",
      index: selectedLine,
      pointIndex: 1,
      newPoint: patternFinal,
      isConstrained: axisConstrained,
    });
    // Mark this endpoint as selected for arrow-key nudging.
    const newSelectedEnd = { lineIndex: selectedLine, endIndex: 1 as const };
    setSelectedEnd(newSelectedEnd);
    // Show loupe at the final endpoint position and keep it visible briefly.
    const finalScreenPt = transformPoint(
      patternFinal,
      calibrationTransform.mmul(patternToCalibrated),
    );
    dispatchLoupePoint(finalScreenPt);
    startLoupeLingerTimer();
  };

  function handleDeleteLine() {
    if (selectedLine >= 0) {
      dispatchLines({ type: "remove", index: selectedLine });
      if (selectedLine === 0) {
        setSelectedLine(lines.length - 2);
      } else {
        setSelectedLine(selectedLine - 1);
      }
    }
  }

  useEffect(() => {
    if (measuring && selectedLine < 0 && lines.length > 0) {
      setSelectedLine(0);
    }
  }, [measuring, lines.length, selectedLine]);

  // Clamp selectedLine if the lines array shrinks (e.g. after undo or delete).
  useEffect(() => {
    if (selectedLine >= lines.length) {
      setSelectedLine(lines.length - 1);
    }
  }, [lines.length, selectedLine, setSelectedLine]);

  // Clear selectedEnd if the referenced line is deleted.
  useEffect(() => {
    if (selectedEnd && selectedEnd.lineIndex >= lines.length) {
      setSelectedEnd(null);
    }
  }, [lines.length, selectedEnd]);

  useKeyDown(() => {
    setAxisConstrained(true);
    // If we're mid endpoint-drag, immediately apply the constrained position —
    // both to the line data and to the loupe — so the user doesn't have to move
    // the mouse before the constraint is visually applied.
    if (
      dragOffset.current &&
      lastDragClientRef.current &&
      !draggingWholeLine.current
    ) {
      const {
        transform: t,
        patternScale: ps,
        calibrationTransform: ct,
        perspective: p,
        dispatchLines: dl,
        selectedLine: sl,
        lines: ls,
      } = nudgeStateRef.current
      if (sl < 0) return
      const patternToCalibrated = t.mmul(scale(ps))
      const clientDestination = {
        x: lastDragClientRef.current.x + dragOffset.current.x,
        y: lastDragClientRef.current.y + dragOffset.current.y,
      }
      const matFinal = transformPoint(clientDestination, p)
      const matLine = transformLine(ls[sl], patternToCalibrated)
      const matFinalConstrained = constrained(matFinal, matLine.points[0])
      const patternDest = transformPoint(matFinalConstrained, inverse(patternToCalibrated))
      dl({
        type: "update-point",
        index: sl,
        pointIndex: 1,
        newPoint: patternDest,
        isConstrained: true,
      })
      dispatchLoupePoint(transformPoint(patternDest, ct.mmul(patternToCalibrated)))
    }
  }, [KeyCode.Shift]);

  useKeyUp(() => {
    setAxisConstrained(false);
    // If we're mid endpoint-drag, immediately apply the unconstrained position —
    // both to the line data and to the loupe — so the user doesn't have to move
    // the mouse before the constraint is visually released.
    if (
      dragOffset.current &&
      lastDragClientRef.current &&
      !draggingWholeLine.current
    ) {
      const {
        transform: t,
        patternScale: ps,
        calibrationTransform: ct,
        perspective: p,
        dispatchLines: dl,
        selectedLine: sl,
      } = nudgeStateRef.current
      if (sl < 0) return
      const patternToCalibrated = t.mmul(scale(ps))
      const clientDestination = {
        x: lastDragClientRef.current.x + dragOffset.current.x,
        y: lastDragClientRef.current.y + dragOffset.current.y,
      }
      const matFinal = transformPoint(clientDestination, p)
      const patternDest = transformPoint(matFinal, inverse(patternToCalibrated))
      dl({
        type: "update-point",
        index: sl,
        pointIndex: 1,
        newPoint: patternDest,
        isConstrained: false,
      })
      dispatchLoupePoint(transformPoint(patternDest, ct.mmul(patternToCalibrated)))
    }
  }, [KeyCode.Shift]);

  useKeyDown(() => {
    setSelectedEnd(null);
    if (loupeLingerTimerRef.current) clearTimeout(loupeLingerTimerRef.current);
    loupeLingerTimerRef.current = null;
    loupeLingerActiveRef.current = false;
    dispatchLoupePoint(null);
  }, [KeyCode.Escape]);

  // Bundle all mutable nudge values into a single stable ref so the nudge
  // handler never needs to be recreated, and always reads the latest values.
  const nudgeStateRef = useRef({
    selectedEnd,
    selectedLine,
    lines,
    transform,
    patternScale,
    calibrationTransform,
    perspective,
    dispatchLines,
    pushLinesSnapshot,
    unitOfMeasure,
  });
  nudgeStateRef.current = {
    selectedEnd,
    selectedLine,
    lines,
    transform,
    patternScale,
    calibrationTransform,
    perspective,
    dispatchLines,
    pushLinesSnapshot,
    unitOfMeasure,
  };

  /**
   * Nudges the selected endpoint by `step` pattern-space units in the arrow
   * direction. Step sizes are defined in physical units (cm or in) so the
   * displayed distance always increments by a clean amount.
   * Shows the loupe at the new position and auto-hides it after 2 seconds.
   */
  const nudgeSelectedEnd = useCallback(
    (key: KeyCode, step: number, _fullScreen: boolean, shiftKey = false) => {
      const {
        selectedEnd: end,
        lines: currentLines,
        transform: t,
        patternScale: ps,
        calibrationTransform: cal,
        dispatchLines: dl,
        pushLinesSnapshot: snap,
      } = nudgeStateRef.current;

      if (!end) return;
      const { lineIndex, endIndex } = end;
      if (lineIndex < 0 || lineIndex >= currentLines.length) return;

      const patternPoint = currentLines[lineIndex].points[endIndex];

      // shiftKey is read directly from the keyboard event (via useProgArrowKeyHandler)
      // to avoid the stuck-key problem where axisConstrained state can remain true
      // if the keyup event was missed.
      const effectiveStep = shiftKey ? step * 10 : step;

      // Apply step directly in pattern space.
      const offset =
        key === KeyCode.ArrowLeft
          ? { x: -effectiveStep, y: 0 }
          : key === KeyCode.ArrowRight
            ? { x: effectiveStep, y: 0 }
            : key === KeyCode.ArrowUp
              ? { x: 0, y: -effectiveStep }
              : { x: 0, y: effectiveStep };

      const newPatternPt = {
        x: patternPoint.x + offset.x,
        y: patternPoint.y + offset.y,
      };

      snap();
      dl({
        type: "update-point",
        index: lineIndex,
        pointIndex: endIndex,
        newPoint: newPatternPt,
        isConstrained: false,
      });

      // Convert new pattern position to screen for the loupe.
      const patternToClient = cal.mmul(t.mmul(scale(ps)));
      const newScreenPt = transformPoint(newPatternPt, patternToClient);

      dispatchLoupePoint(newScreenPt);
      startLoupeLingerTimer();
    },
    [],
  );

  // Step sizes in pattern-space units (cm or in) that increase as the key is held.
  const nudgeStepList =
    unitOfMeasure === Unit.IN
      ? [1 / 32, 1 / 16, 1 / 8, 1 / 4] // 1/32" increments up to 1/4"
      : [0.05, 0.1, 0.25, 0.5]; // 0.5 mm increments up to 5 mm

  useProgArrowKeyHandler(
    nudgeSelectedEnd,
    selectedEnd !== null && !magnifying,
    nudgeStepList,
    false,
  );

  // Sync the shared measurement-end-selected flag so Draggable can suppress
  // canvas panning while an endpoint is selected for nudging.
  useEffect(() => {
    measureEndSelectedRef.current = selectedEnd !== null;
    return () => {
      measureEndSelectedRef.current = false;
    };
  }, [selectedEnd]);

  // Tab: cycle between the two ends of the selected line.
  tabHandlerRef.current = () => {
    if (!selectedEnd) return;
    const newEndIndex = (selectedEnd.endIndex === 0 ? 1 : 0) as 0 | 1;
    const newEnd = { lineIndex: selectedEnd.lineIndex, endIndex: newEndIndex };
    setSelectedEnd(newEnd);
    // Show loupe at the newly selected endpoint.
    const line = lines[newEnd.lineIndex];
    if (line) {
      const patternToClient = calibrationTransform.mmul(
        transform.mmul(scale(patternScale)),
      );
      const pt = transformPoint(line.points[newEnd.endIndex], patternToClient);
      dispatchLoupePoint(pt);
      startLoupeLingerTimer();
    }
  };
  useKeyDown(() => tabHandlerRef.current(), [KeyCode.Tab]);

  // Clean up the loupe linger timer on unmount.
  useEffect(
    () => () => {
      if (loupeLingerTimerRef.current)
        clearTimeout(loupeLingerTimerRef.current);
      loupeLingerActiveRef.current = false;
    },
    [],
  );

  // When the lines change (e.g. undo/redo) while an endpoint is selected,
  // move the loupe to the updated endpoint position so it stays in sync.
  useEffect(() => {
    if (!selectedEnd) return;
    if (dragOffset.current !== null) return; // actively dragging — we handle this ourselves
    const line = lines[selectedEnd.lineIndex];
    if (!line) return;
    const patternToClient = calibrationTransform.mmul(
      transform.mmul(scale(patternScale)),
    );
    const pt = transformPoint(
      line.points[selectedEnd.endIndex],
      patternToClient,
    );
    dispatchLoupePoint(pt);
    startLoupeLingerTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  useEffect(() => {
    dispatchLines({
      type: "update-unit-of-measure",
      unitOfMeasure,
    });
  }, [unitOfMeasure]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.canvas.width = window.innerWidth;
        ctx.canvas.height = window.innerHeight;
        ctx.strokeStyle = "#FF4500";

        ctx.lineWidth = 4;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const patternToCalibrated = transform.mmul(scale(patternScale));
        // When magnified, include magnifyTransform to match Draggable's
        // CSS transform chain: cal × mag × local × scale.
        const patternToClient = magnifyTransform
          ? calibrationTransform
              .mmul(magnifyTransform)
              .mmul(patternToCalibrated)
          : calibrationTransform.mmul(patternToCalibrated);
        for (let i = 0; i < lines.length; i++) {
          if (i !== selectedLine) {
            drawLine(ctx, transformLine(lines[i], patternToClient).points);
          }
        }

        if (
          lines.length > 0 &&
          selectedLine >= 0 &&
          selectedLine < lines.length
        ) {
          // Style selected line differently.
          ctx.strokeStyle = accentColor;

          const patternLine = lines[selectedLine];
          const matLine = transformLine(patternLine, transform);
          const scaledMatLine = transformLine(patternLine, patternToCalibrated);
          if (axisConstrained && dragOffset.current) {
            matLine.points[1] = constrained(
              matLine.points[1],
              matLine.points[0],
            );
            scaledMatLine.points[1] = constrained(
              scaledMatLine.points[1],
              scaledMatLine.points[0],
            );
          }
          const calMag = magnifyTransform
            ? calibrationTransform.mmul(magnifyTransform)
            : calibrationTransform;
          const clientLine = transformLine(scaledMatLine, calMag).points;
          drawArrow(
            ctx,
            clientLine,
            hoveredEnd?.lineIndex === selectedLine
              ? {
                  start: hoveredEnd.endIndex === 0,
                  end: hoveredEnd.endIndex === 1,
                }
              : undefined,
          );
          drawMeasurementsAt(ctx, matLine, clientLine[1]);
        }

        // Draw dashed body overlay on hovered line — rendered last so it sits on top.
        if (hoveredLineIndex >= 0 && hoveredLineIndex < lines.length) {
          const hClientLine = transformLine(
            lines[hoveredLineIndex],
            patternToClient,
          );
          const hColor =
            hoveredLineIndex === selectedLine ? accentColor : "#FF4500";
          ctx.save();
          // First pass: erase the solid line in the gap intervals to make transparent gaps.
          ctx.globalCompositeOperation = "destination-out";
          ctx.setLineDash([6, 6]);
          ctx.lineDashOffset = 0;
          drawLine(ctx, hClientLine.points);
          // Second pass: draw coloured dashes in the remaining intervals.
          ctx.globalCompositeOperation = "source-over";
          ctx.strokeStyle = hColor;
          ctx.setLineDash([6, 6]);
          ctx.lineDashOffset = 6;
          drawLine(ctx, hClientLine.points);
          ctx.restore();
        }

        // Draw end cap on hovered or selected endpoint.
        // "Selected" (last-touched, ready to nudge) shows a solid whisker + circle.
        // Hover-only shows a dashed whisker + circle.
        const isEndpointSelected = (lineIdx: number, endIdx: 0 | 1) =>
          selectedEnd !== null &&
          selectedEnd.lineIndex === lineIdx &&
          selectedEnd.endIndex === endIdx;

        if (hoveredEnd !== null && hoveredEnd.lineIndex < lines.length) {
          const hClientLine = transformLine(
            lines[hoveredEnd.lineIndex],
            patternToClient,
          );
          const p0 = hClientLine.points[0];
          const p1 = hClientLine.points[1];
          const hPoint = hClientLine.points[hoveredEnd.endIndex];
          const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
          const whisker = 16;
          const isSelected = isEndpointSelected(
            hoveredEnd.lineIndex,
            hoveredEnd.endIndex,
          );
          ctx.save();
          ctx.strokeStyle =
            hoveredEnd.lineIndex === selectedLine ? accentColor : "#FF4500";
          if (isSelected) {
            ctx.setLineDash([]);
          } else {
            ctx.setLineDash([4, 4]);
          }
          ctx.beginPath();
          ctx.moveTo(
            hPoint.x + Math.cos(angle + Math.PI / 2) * whisker,
            hPoint.y + Math.sin(angle + Math.PI / 2) * whisker,
          );
          ctx.lineTo(
            hPoint.x + Math.cos(angle - Math.PI / 2) * whisker,
            hPoint.y + Math.sin(angle - Math.PI / 2) * whisker,
          );
          ctx.stroke();
          ctx.setLineDash([]);
          drawCircle(ctx, hPoint, 30);
          ctx.restore();
        }

        // Draw selected circle for endpoints that are selected but not currently hovered.
        if (selectedEnd !== null && selectedEnd.lineIndex < lines.length) {
          const hovered =
            hoveredEnd !== null &&
            hoveredEnd.lineIndex === selectedEnd.lineIndex &&
            hoveredEnd.endIndex === selectedEnd.endIndex;
          if (!hovered) {
            const sClientLine = transformLine(
              lines[selectedEnd.lineIndex],
              patternToClient,
            );
            const sp0 = sClientLine.points[0];
            const sp1 = sClientLine.points[1];
            const sPoint = sClientLine.points[selectedEnd.endIndex];
            const sAngle = Math.atan2(sp1.y - sp0.y, sp1.x - sp0.x);
            const whisker = 16;
            ctx.save();
            ctx.strokeStyle =
              selectedEnd.lineIndex === selectedLine ? accentColor : "#FF4500";
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(
              sPoint.x + Math.cos(sAngle + Math.PI / 2) * whisker,
              sPoint.y + Math.sin(sAngle + Math.PI / 2) * whisker,
            );
            ctx.lineTo(
              sPoint.x + Math.cos(sAngle - Math.PI / 2) * whisker,
              sPoint.y + Math.sin(sAngle - Math.PI / 2) * whisker,
            );
            ctx.stroke();
            drawCircle(ctx, sPoint, 30);
            ctx.restore();
          }
        }
      }
    }

    function drawMeasurementsAt(
      ctx: CanvasRenderingContext2D,
      line: Line,
      p1: Point,
    ) {
      ctx.save();
      ctx.font = "24px sans-serif";
      ctx.strokeStyle = isDarkTheme ? "#000" : "#fff";
      ctx.fillStyle = isDarkTheme ? "#fff" : "#000";
      const text = `${line.distance}${line.unitOfMeasure.toLocaleLowerCase()} ${line.angle}°`;
      ctx.lineWidth = 4;

      // Measure text width so we can choose a position that avoids screen
      // edges and the loupe (which sits top-right or top-left of the endpoint).
      const textWidth = ctx.measureText(text).width;
      const textHeight = 24;
      const gap = END_CIRCLE_RADIUS + 8;
      const screenW = window.innerWidth;
      const screenH = window.innerHeight;

      // When the loupe is forced below the endpoint (near top of screen),
      // always place the text above so they never occupy the same side.
      const loupeIsBelow = p1.y - LOUPE_GAP - LOUPE_DISPLAY_PX < SCREEN_MARGIN;
      // Prefer below the endpoint; fall back above if near the bottom edge
      // or the loupe has taken the bottom position.
      const useAbove = loupeIsBelow || p1.y + gap + textHeight > screenH - 10;
      const y = useAbove ? p1.y - gap : p1.y + gap + textHeight;
      // Prefer to the right; fall back to left if near the right edge.
      const useLeft = p1.x + gap + textWidth > screenW - 10;
      const x = useLeft ? p1.x - gap - textWidth : p1.x + gap;

      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
      ctx.restore();
    }
  }, [
    perspective,
    unitOfMeasure,
    axisConstrained,
    calibrationTransform,
    magnifyTransform,
    lines,
    transform,
    selectedLine,
    hoveredEnd,
    hoveredLineIndex,
    measuring,
    isDarkTheme,
    patternScale,
    selectedEnd,
  ]);

  useEffect(() => {
    const currentFileKey = file
      ? `${file.name}:${file.size}:${file.lastModified}`
      : null;

    if (previousFileKey.current === null) {
      previousFileKey.current = currentFileKey;
      return;
    }

    if (previousFileKey.current !== currentFileKey) {
      dispatchLines({ type: "reset" });
      setSelectedLine(-1);
    }

    previousFileKey.current = currentFileKey;
  }, [file, dispatchLines, setSelectedLine]);

  useEffect(() => {
    if (zoomedOut || magnifying) {
      setMeasuring(false);
      setSelectedLine(-1);
      setSelectedEnd(null);
    }
  }, [zoomedOut, magnifying, setMeasuring, setSelectedLine]);

  return (
    <div className={`relative z-0 ${className ?? ""}`} data-magnify-container>
      <div
        onPointerDownCapture={handlePointerDown}
        onPointerMoveCapture={handlePointerMove}
        onPointerUpCapture={handlePointerUp}
        onPointerLeave={() => {
          setHoveredEnd(null);
          setHoveredLineIndex(-1);
          dispatchLoupePoint(null);
        }}
        className={`${isDraggingWholeLine ? "cursor-grabbing" : hoveredEnd !== null ? "cursor-crosshair" : hoveredLineIndex >= 0 ? "cursor-grab" : measuring ? "cursor-crosshair" : ""} h-screen w-screen`}
      >
        <div className={`${disablePointer ? "pointer-events-none" : ""}`}>
          {children}
        </div>
        <canvas
          ref={canvasRef}
          className={`absolute top-0 inset-0 z-20 w-full h-full pointer-events-none`}
        ></canvas>
      </div>
      <LineMenu
        selectedLine={selectedLine}
        setSelectedLine={setSelectedLine}
        lines={lines}
        dispatchLines={dispatchLines}
        pushLinesSnapshot={pushLinesSnapshot}
        handleDeleteLine={handleDeleteLine}
        gridCenter={gridCenter}
        setMeasuring={setMeasuring}
        menusHidden={menusHidden}
        menuStates={menuStates}
        unitOfMeasure={unitOfMeasure}
      />
    </div>
  );
}
