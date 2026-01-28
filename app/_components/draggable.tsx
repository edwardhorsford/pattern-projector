import { Matrix } from "ml-matrix";
import {
  ReactNode,
  useState,
  useEffect,
  SetStateAction,
  Dispatch,
} from "react";

import {
  RestoreTransforms,
  toMatrix3d,
  transformPoint,
  translate,
  scale,
  scaleAboutPoint,
  transformPoints,
  getBounds,
  rectCorners,
} from "@/_lib/geometry";
import { Point } from "@/_lib/point";
import { CSS_PIXELS_PER_INCH } from "@/_lib/pixels-per-inch";
import { Unit } from "@/_lib/unit";
import useProgArrowKeyToMatrix from "@/_hooks/use-prog-arrow-key-to-matrix";
import { visible } from "./theme/css-functions";
import {
  useTransformContext,
  useTransformerContext,
} from "@/_hooks/use-transform-context";
import { MenuStates } from "@/_lib/menu-states";
import { inverse } from "ml-matrix";
import { Marker, createMarker } from "@/_lib/marker";

export default function Draggable({
  children,
  perspective,
  isCalibrating,
  unitOfMeasure,
  calibrationTransform,
  setCalibrationTransform,
  setPerspective,
  className,
  magnifying,
  setMagnifying,
  restoreTransforms,
  setRestoreTransforms,
  zoomedOut,
  setZoomedOut,
  layoutWidth,
  layoutHeight,
  calibrationCenter,
  menuStates,
  file,
  markingMode,
  setMarkingMode,
  clearingMode,
  setClearingMode,
  markers,
  setMarkers,
}: {
  children: ReactNode;
  perspective: Matrix;
  isCalibrating: boolean;
  unitOfMeasure: Unit;
  calibrationTransform: Matrix;
  setCalibrationTransform: Dispatch<SetStateAction<Matrix>>;
  setPerspective: Dispatch<SetStateAction<Matrix>>;
  className: string;
  magnifying: boolean;
  setMagnifying: Dispatch<SetStateAction<boolean>>;
  setRestoreTransforms: Dispatch<SetStateAction<RestoreTransforms | null>>;
  restoreTransforms: RestoreTransforms | null;
  zoomedOut: boolean;
  setZoomedOut: Dispatch<SetStateAction<boolean>>;
  layoutWidth: number;
  layoutHeight: number;
  calibrationCenter: Point;
  menuStates: MenuStates;
  file: File | null;
  markingMode: boolean;
  setMarkingMode: Dispatch<SetStateAction<boolean>>;
  clearingMode: boolean;
  setClearingMode: Dispatch<SetStateAction<boolean>>;
  markers: Marker[];
  setMarkers: Dispatch<SetStateAction<Marker[]>>;
}) {
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [transformStart, setTransformStart] = useState<Matrix | null>(null);

  const transform = useTransformContext();
  const transformer = useTransformerContext();

  const eighthInchPx = CSS_PIXELS_PER_INCH / 8;
  const twoMmPx = CSS_PIXELS_PER_INCH / 12.7;

  useProgArrowKeyToMatrix(
    !isCalibrating,
    unitOfMeasure === Unit.IN ? eighthInchPx : twoMmPx,
    (matrix) => {
      transformer.setLocalTransform(matrix.mmul(transform));
    },
  );

  function handleOnEnd(): void {
    setDragStart(null);
    setTransformStart(null);
  }

  function handleMove(e: React.PointerEvent) {
    const p = { x: e.clientX, y: e.clientY };

    if (e.pointerType === "mouse") {
      /* If we aren't currently dragging, ignore the mouse move event */
      if (dragStart === null) {
        return;
      }
      if (e.buttons === 0 && dragStart !== null) {
        // If the mouse button is released, end the drag.
        handleOnEnd();
        return;
      }
    }

    if (transformStart !== null && dragStart !== null) {
      const dest = transformPoint(p, perspective);
      const tx = dest.x - dragStart.x;
      const ty = dest.y - dragStart.y;
      const vec = { x: tx, y: ty };
      transformer.setLocalTransform(translate(vec).mmul(transformStart));
    }
  }

  function handleOnStart(e: React.PointerEvent): void {
    const p = { x: e.clientX, y: e.clientY };
    const pt = transformPoint(p, perspective);
    
    // Convert screen position to PDF coordinates for marker operations
    const inverseLocal = inverse(transform);
    const pdfPoint = transformPoint(pt, inverseLocal);
    
    // If in clearing mode, check if click is near a marker and remove it
    if (clearingMode) {
      // Find the closest marker within a reasonable distance
      // Use half the marker size (2 inches = 144 points) as the click radius
      const clickRadius = 144; // 2 inches in PDF points (half of 4 inch marker)
      let closestMarker: Marker | null = null;
      let closestDistance = Infinity;
      
      for (const marker of markers) {
        const dx = marker.position.x - pdfPoint.x;
        const dy = marker.position.y - pdfPoint.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < clickRadius && distance < closestDistance) {
          closestDistance = distance;
          closestMarker = marker;
        }
      }
      
      if (closestMarker) {
        setMarkers(markers.filter(m => m.id !== closestMarker!.id));
      }
      // Always disable clearing mode after a click (one-time action)
      setClearingMode(false);
      return;
    }
    
    // If in marking mode, place a marker and return
    if (markingMode) {
      const newMarker = createMarker(pdfPoint);
      setMarkers([...markers, newMarker]);
      // Auto-disable marking mode after placing a marker
      setMarkingMode(false);
      return;
    }
    
    if (magnifying) {
      if (restoreTransforms === null) {
        setRestoreTransforms({
          localTransform: transform.clone(),
          calibrationTransform: calibrationTransform.clone(),
        });
        transformer.magnify(5, pt);
        setDragStart(pt);
        setTransformStart(scaleAboutPoint(5, pt).mmul(transform));
      } else {
        setMagnifying(false);
      }
    } else if (restoreTransforms !== null) {
      // zoomed out, so we need to zoom in
      const oldLocal = restoreTransforms.localTransform;
      const dest = transformPoint(transformPoint(p, perspective), oldLocal);
      const newLocal = translate({
        x: -dest.x + calibrationCenter.x,
        y: -dest.y + calibrationCenter.y,
      }).mmul(oldLocal);
      setRestoreTransforms({
        localTransform: newLocal,
        calibrationTransform: restoreTransforms.calibrationTransform.clone(),
      });
      setZoomedOut(false);
    } else {
      setDragStart(pt);
      setTransformStart(transform.clone());
    }
  }

  useEffect(() => {
    if (zoomedOut && restoreTransforms === null) {
      setRestoreTransforms({
        localTransform: transform.clone(),
        calibrationTransform: calibrationTransform.clone(),
      });
      const layerMenuWidth = 190;
      const stitchMenuHeight = 81;
      const navHeight = 64;
      let x = menuStates.layers ? layerMenuWidth : 0;
      const y = menuStates.stitch ? navHeight + stitchMenuHeight : navHeight;

      // get four corners layout width and height
      // transform the four corners to the perspective
      // find the min and max x and y
      const [min, max] = getBounds(
        transformPoints(rectCorners(layoutWidth, layoutHeight), transform),
      );
      const w = max.x - min.x;
      const h = max.y - min.y;
      // scale to fit below/next to the menu
      const s = Math.min(
        (window.innerWidth - x) / w,
        (window.innerHeight - y) / h,
      );
      // center the layout
      if (x + w * s < window.innerWidth) {
        x = (window.innerWidth - w * s) / 2;
      }

      const zoomOut = translate({ x, y })
        .mmul(scale(s))
        .mmul(translate({ x: -min.x, y: -min.y }))
        .mmul(transform);

      setCalibrationTransform(zoomOut.clone());
      setPerspective(inverse(zoomOut.clone()));
      transformer.setLocalTransform(Matrix.identity(3));
    }
  }, [
    zoomedOut,
    setZoomedOut,
    transform,
    transformer,
    layoutWidth,
    layoutHeight,
    restoreTransforms,
    menuStates,
    setCalibrationTransform,
    setPerspective,
    calibrationTransform,
    setRestoreTransforms,
  ]);

  useEffect(() => {
    transformer.setLocalTransform(Matrix.identity(3));
  }, [file]);

  useEffect(() => {
    if (!magnifying && !zoomedOut && restoreTransforms !== null) {
      transformer.setLocalTransform(restoreTransforms.localTransform);
      setCalibrationTransform(restoreTransforms.calibrationTransform);
      setPerspective(inverse(restoreTransforms.calibrationTransform));
      setRestoreTransforms(null);
    }
  }, [
    magnifying,
    zoomedOut,
    restoreTransforms,
    setRestoreTransforms,
    setCalibrationTransform,
    transformer,
    setPerspective,
  ]);

  let cursorMode = "cursor-grab";

  if (clearingMode) {
    cursorMode = "cursor-cell"; // Cell cursor for removal selection
  } else if (markingMode) {
    cursorMode = "cursor-crosshair";
  } else if (zoomedOut || magnifying) {
    cursorMode = "cursor-zoom-in";
  }
  if (magnifying && restoreTransforms !== null) {
    cursorMode = "cursor-zoom-out";
  }
  if (dragStart !== null) {
    cursorMode = "cursor-grabbing";
  }

  return (
    <div
      tabIndex={0}
      className={`${className ?? ""} ${cursorMode} ${visible(!isCalibrating)} select-none absolute top-0 bg-white dark:bg-black transition-all duration-500 w-screen h-screen`}
      onPointerMove={handleMove}
      onPointerDown={handleOnStart}
      onPointerUp={handleOnEnd}
    >
      <div
        className={"absolute"}
        style={{
          transform: `${toMatrix3d(calibrationTransform.mmul(transform))}`,
          transformOrigin: "0 0",
        }}
      >
        {children}
      </div>
    </div>
  );
}
