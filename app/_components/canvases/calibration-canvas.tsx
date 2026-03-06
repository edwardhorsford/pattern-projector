import React, {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { CanvasState, drawPolygon, drawGrid } from "@/_lib/drawing";
import {
  getPerspectiveTransformFromPoints,
  transformPoint,
} from "@/_lib/geometry";
import { minIndex, sqrDist, sqrDistToLine } from "@/_lib/geometry";
import { Point } from "@/_lib/point";
import { DisplaySettings, strokeColor } from "@/_lib/display-settings";
import useProgArrowKeyPoints from "@/_hooks/use-prog-arrow-key-points";
import { useKeyDown } from "@/_hooks/use-key-down";
import { KeyCode } from "@/_lib/key-code";
import { PointAction } from "@/_reducers/pointsReducer";
import { FullScreenHandle } from "react-full-screen";
import Matrix, { inverse } from "ml-matrix";
import { getCalibrationContextUpdatedWithEvent } from "@/_lib/calibration-context";
import { Unit } from "@/_lib/unit";

const maxPoints = 4; // One point per vertex in rectangle
const cornerMargin = 96;

export default function CalibrationCanvas({
  className,
  points,
  dispatch,
  width,
  height,
  isCalibrating,
  unitOfMeasure,
  displaySettings,
  corners,
  setCorners,
  fullScreenHandle,
  pushCalibrationSnapshot,
}: {
  className: string | undefined;
  points: Point[];
  dispatch: Dispatch<PointAction>;
  width: number;
  height: number;
  isCalibrating: boolean;
  unitOfMeasure: Unit;
  displaySettings: DisplaySettings;
  corners: Set<number>;
  setCorners: Dispatch<SetStateAction<Set<number>>>;
  fullScreenHandle: FullScreenHandle;
  pushCalibrationSnapshot?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoverCorners, setHoverCorners] = useState<Set<number>>(new Set());
  const [dragPoint, setDragPoint] = useState<Point | null>(null);

  // Stored at the start of an edge drag so we compute positions absolutely
  // from the initial state rather than accumulating incremental screen deltas.
  const dragPatternStartRef = useRef<Point | null>(null);
  const dragInitialMatrixRef = useRef<Matrix | null>(null);
  const dragInitialInverseMatrixRef = useRef<Matrix | null>(null);
  const dragInitialPointsRef = useRef<Point[] | null>(null);

  useEffect(() => {
    if (
      canvasRef !== null &&
      canvasRef.current !== null &&
      points &&
      points.length === maxPoints
    ) {
      /* All drawing is done in unitsOfMeasure, ptDensity = 1.0 */
      const perspectiveMatrix = getPerspectiveTransformFromPoints(
        points,
        width,
        height,
        1.0,
        false,
      );

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");

      if (ctx !== null) {
        ctx.canvas.width = window.innerWidth;
        ctx.canvas.height = window.innerHeight;
        const cs = new CanvasState(
          ctx,
          { x: 0, y: 0 },
          points,
          width,
          height,
          perspectiveMatrix,
          isCalibrating,
          corners,
          hoverCorners,
          unitOfMeasure,
          strokeColor(displaySettings.theme),
          displaySettings,
          false,
          Matrix.identity(3),
          false,
          false,
          null,
          null,
          null,
          null,
        );
        draw(cs);
      }
    }
  }, [
    points,
    width,
    height,
    isCalibrating,
    corners,
    hoverCorners,
    unitOfMeasure,
    displaySettings,
  ]);

  function isNearCenter(p: Point): boolean {
    const sum = points.reduce(
      (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
      { x: 0, y: 0 },
    );
    const center = {
      x: sum.x / points.length,
      y: sum.y / points.length,
    };
    return sqrDist(center, p) < 4 * cornerMargin ** 2;
  }

  function selectCorners(p: Point): Set<number> {
    const corner = getNearbyCorner(p);
    if (corner !== -1) {
      return new Set([corner]);
    }
    const edges = getNearbyEdge(p);
    if (edges.length) {
      return new Set(getNearbyEdge(p));
    }
    if (isNearCenter(p)) {
      return new Set([0, 1, 2, 3]);
    }
    return new Set();
  }

  function getNearbyEdge(p: Point): number[] {
    const distances = points.map((a, idx) =>
      sqrDistToLine([a, points[(idx + 1) % points.length]], p),
    );
    const edge = minIndex(distances);
    if (cornerMargin ** 2 > distances[edge]) {
      return [edge, edge === points.length - 1 ? 0 : edge + 1];
    }
    return [];
  }

  function getNearbyCorner(p: Point): number {
    const distances = points.map((a) => sqrDist(a, p));
    const corner = minIndex(distances);
    if (cornerMargin ** 2 > distances[corner]) {
      return corner;
    }
    return -1;
  }

  const handleKeyDown = useCallback(
    function (e: React.KeyboardEvent) {
      if (e.code === "Escape") {
        if (corners.size) {
          if (e.target instanceof HTMLElement) {
            e.target.blur();
          }
          setCorners(new Set());
        }
      }
    },
    [corners, setCorners],
  );

  useKeyDown(
    (e: KeyboardEvent) => {
      if (corners.size === 4 || corners.size === 0) {
        setCorners(new Set([0]));
      } else {
        const inc = e.shiftKey ? 3 : 1;
        setCorners(new Set(Array.from(corners).map((c) => (c + inc) % 4)));
      }
    },
    [KeyCode.Tab],
  );

  // Wrap dispatch to snapshot calibration state before each arrow-key move.
  const dispatchWithSnapshot = useCallback(
    (action: PointAction) => {
      pushCalibrationSnapshot?.();
      dispatch(action);
    },
    [dispatch, pushCalibrationSnapshot],
  );

  useProgArrowKeyPoints(
    dispatchWithSnapshot,
    corners,
    isCalibrating,
    fullScreenHandle.active,
  );

  /** Returns the fixed pattern-space position for a given corner index. */
  function getPatternCorner(corner: number): Point {
    switch (corner) {
      case 0:
        return { x: 0, y: 0 };
      case 1:
        return { x: width, y: 0 };
      case 2:
        return { x: width, y: height };
      case 3:
        return { x: 0, y: height };
      default:
        return { x: 0, y: 0 };
    }
  }

  function handlePointerDown(e: React.PointerEvent) {
    const p = { x: e.clientX, y: e.clientY };
    const selectedCorners = selectCorners(p);
    if (selectedCorners.size) {
      pushCalibrationSnapshot?.();
      setDragPoint(p);
      setCorners(selectedCorners);
      setHoverCorners(new Set());

      if (selectedCorners.size === 2) {
        // For edge drags, capture pattern-space context so we can drag in pattern space.
        const pm = getPerspectiveTransformFromPoints(
          points,
          width,
          height,
          1.0,
          false,
        );
        const pmInverse = inverse(pm);
        dragInitialMatrixRef.current = pm;
        dragInitialInverseMatrixRef.current = pmInverse;
        dragPatternStartRef.current = transformPoint(p, pmInverse);
        dragInitialPointsRef.current = [...points];
      } else {
        dragPatternStartRef.current = null;
        dragInitialMatrixRef.current = null;
        dragInitialInverseMatrixRef.current = null;
        dragInitialPointsRef.current = null;
      }
    }
  }

  function handlePointerMove(e: React.PointerEvent) {
    const p = { x: e.clientX, y: e.clientY };
    if (dragPoint === null) {
      setHoverCorners(selectCorners(p));
    } else if (
      corners.size === 2 &&
      dragPatternStartRef.current !== null &&
      dragInitialInverseMatrixRef.current !== null &&
      dragInitialMatrixRef.current !== null &&
      dragInitialPointsRef.current !== null
    ) {
      // Edge drag in pattern space:
      // Convert current pointer to pattern space, constrain to the relevant
      // axis, then project the new pattern positions back to screen space using
      // the transform captured at drag-start. This keeps the quadrilateral
      // angles intact while only changing the relevant dimension.
      const patternP = transformPoint(p, dragInitialInverseMatrixRef.current);
      let patternDx = patternP.x - dragPatternStartRef.current.x;
      let patternDy = patternP.y - dragPatternStartRef.current.y;

      if (hasTopEdge(corners) || hasBottomEdge(corners)) {
        patternDx = 0;
      } else {
        patternDy = 0;
      }

      const newPoints = [...dragInitialPointsRef.current];
      for (const corner of corners) {
        const basePattern = getPatternCorner(corner);
        const newPattern = {
          x: basePattern.x + patternDx,
          y: basePattern.y + patternDy,
        };
        newPoints[corner] = transformPoint(
          newPattern,
          dragInitialMatrixRef.current,
        );
      }
      dispatch({ type: "set", points: newPoints });
    } else if (corners.size) {
      // Corner or full-grid drag: keep existing screen-space behaviour.
      const newPoints = [...points];
      const dx = p.x - dragPoint.x;
      const dy = p.y - dragPoint.y;
      for (const corner of corners) {
        const currentPoint = newPoints[corner];
        newPoints[corner] = {
          x: currentPoint.x + dx,
          y: currentPoint.y + dy,
        };
      }
      setDragPoint(p);
      dispatch({ type: "set", points: newPoints });
    }
  }

  function handlePointerEnd(e: React.PointerEvent) {
    /* Nothing to do. This short circuit is required to prevent setting
     * the localStorage of the points to invalid values */
    if (dragPoint === null) return;

    localStorage.setItem(
      "calibrationContext",
      JSON.stringify(
        getCalibrationContextUpdatedWithEvent(e, fullScreenHandle.active),
      ),
    );
    dispatch({ type: "set", points });
    setDragPoint(null);
  }

  return (
    <canvas
      data-testid="calibration-canvas"
      tabIndex={0}
      ref={canvasRef}
      className={`${className} outline-none`}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerEnd}
      onPointerOut={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
      onPointerMove={handlePointerMove}
      style={{
        pointerEvents: isCalibrating ? "auto" : "none",
        cursor: dragPoint ? "none" : "grab",
      }}
    />
  );
}

function hasTopEdge(corners: Set<number>): boolean {
  return corners.has(0) && corners.has(1);
}

function hasBottomEdge(corners: Set<number>): boolean {
  return corners.has(2) && corners.has(3);
}

function hasLeftEdge(corners: Set<number>): boolean {
  return corners.has(0) && corners.has(3);
}

function hasRightEdge(corners: Set<number>): boolean {
  return corners.has(1) && corners.has(2);
}

function draw(cs: CanvasState): void {
  const { ctx, isCalibrating } = cs;
  if (isCalibrating) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    drawCalibration(cs);
  } else if (cs.isConcave) {
    ctx.fillStyle = cs.errorFillPattern;
    drawPolygon(ctx, cs.points);
    ctx.fill();
  }
}

function drawCalibrationPoints(cs: CanvasState) {
  const { ctx, points, corners, hoverCorners, displaySettings } = cs;
  points.forEach((point, index) => {
    ctx.beginPath();
    const oneCorner = corners.size === 1 && corners.has(index);
    const radius = oneCorner ? 20 : 10;
    ctx.strokeStyle = oneCorner
      ? "rgb(147, 51, 234)"
      : strokeColor(displaySettings.theme);
    if (hoverCorners.size === 1 && hoverCorners.has(index)) {
      ctx.setLineDash([4, 4]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.arc(point.x, point.y, radius, 0, 2 * Math.PI);
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function drawCalibration(cs: CanvasState): void {
  const {
    ctx,
    points,
    errorFillPattern,
    isConcave,
    corners,
    hoverCorners,
    width,
    height,
  } = cs;
  if (isConcave) {
    ctx.fillStyle = errorFillPattern;
    drawPolygon(ctx, points);
    ctx.fill();
  } else {
    ctx.lineWidth = 2;
    ctx.strokeStyle = strokeColor(cs.displaySettings.theme);
    ctx.save();
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const p1 = points[i];
      const p2 = points[j];
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      const isHovered = hoverCorners.has(i) && hoverCorners.has(j);
      if (isHovered) {
        ctx.setLineDash([4, 4]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.stroke();
    }
    ctx.restore();

    function drawChevron(p: Point, angle: number) {
      const ctr = transformPoint(p, cs.perspective);
      ctx.save();
      ctx.translate(ctr.x, ctr.y);
      ctx.rotate(angle);
      const t = 20;
      const s = 10;
      ctx.moveTo(t, -t);
      ctx.lineTo(s, 0);
      ctx.lineTo(t, t);
      ctx.restore();
    }

    ctx.beginPath();
    if (hasTopEdge(corners)) {
      drawChevron({ x: width * 0.5, y: 0 }, Math.PI / 2);
    }
    if (hasBottomEdge(corners)) {
      drawChevron({ x: width * 0.5, y: height }, (Math.PI * 3) / 2);
    }
    if (hasLeftEdge(corners)) {
      drawChevron({ x: 0, y: height * 0.5 }, 0);
    }
    if (hasRightEdge(corners)) {
      drawChevron({ x: width, y: height * 0.5 }, Math.PI);
    }
    ctx.stroke();
    drawGrid(cs, 0);
  }

  drawCalibrationPoints(cs);
}
