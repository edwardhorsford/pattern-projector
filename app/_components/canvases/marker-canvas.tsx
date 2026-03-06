"use client";

// marker-canvas.tsx

import React, { useRef, useState } from "react";
import { Marker, MARKER_SIZE_INCHES } from "@/_lib/marker";
import { useTransformContext } from "@/_hooks/use-transform-context";
import Matrix, { inverse } from "ml-matrix";
import { getPtDensity, Unit } from "@/_lib/unit";
import {
  Theme,
  secondaryColor,
  themeRecolourFilter,
} from "@/_lib/display-settings";
import { scale, transformPoint } from "@/_lib/geometry";
import { Point } from "@/_lib/point";
import { useKeyDown } from "@/_hooks/use-key-down";
import { KeyCode } from "@/_lib/key-code";

interface MarkerCanvasProps {
  markers: Marker[];
  calibrationTransform: Matrix;
  magnifyTransform?: Matrix | null;
  patternScale: number;
  unitOfMeasure: Unit;
  theme?: Theme;
  className?: string;
  /** The ID of the currently selected marker, or null if none. */
  selectedMarkerId?: string | null;
  /** Called when a marker is selected or deselected (null = deselect). */
  onSelectMarker?: (id: string | null) => void;
  /** Called while dragging to update a marker's position. */
  onMoveMarker?: (id: string, newPosition: Point) => void;
  /** Called when the selected marker should be deleted. */
  onDeleteMarker?: (id: string) => void;
}

/**
 * Renders markers (checkmarks) on the pattern.
 * Markers are positioned in pattern space and transformed to screen space.
 * The markers themselves remain upright (not rotated/flipped with the pattern).
 *
 * When interaction props are provided, markers can be hovered, selected,
 * dragged to a new position, or deleted with Backspace.
 */
export default function MarkerCanvas({
  markers,
  calibrationTransform,
  magnifyTransform = null,
  patternScale,
  unitOfMeasure,
  theme = Theme.Light,
  className,
  selectedMarkerId = null,
  onSelectMarker,
  onMoveMarker,
  onDeleteMarker,
}: MarkerCanvasProps) {
  const localTransform = useTransformContext();
  const accentColor = secondaryColor(theme);

  const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null);

  // Track drag state: which marker is being dragged, where it started, and the inverse transform.
  const dragState = useRef<{
    markerId: string;
    startPointer: Point;
    startPosition: Point;
    screenToPattern: Matrix;
  } | null>(null);

  const ptDensity = getPtDensity(unitOfMeasure);
  const markerSizePts = MARKER_SIZE_INCHES * ptDensity;

  // Combined transform for positioning markers.
  // When magnified, include magnifyTransform in the chain to match
  // Draggable's CSS transform: cal × mag × local × scale.
  const patternToCalibrated = localTransform.mmul(scale(patternScale));
  const combinedTransform = magnifyTransform
    ? calibrationTransform.mmul(magnifyTransform).mmul(patternToCalibrated)
    : calibrationTransform.mmul(patternToCalibrated);

  const isInteractive = !!(onSelectMarker || onMoveMarker || onDeleteMarker);

  // Backspace deletes the selected marker.
  useKeyDown(() => {
    if (selectedMarkerId && onDeleteMarker) {
      onDeleteMarker(selectedMarkerId);
    }
  }, [KeyCode.Backspace]);

  // Escape deselects the selected marker.
  useKeyDown(() => {
    if (selectedMarkerId && onSelectMarker) {
      onSelectMarker(null);
    }
  }, [KeyCode.Escape]);

  if (markers.length === 0) {
    return null;
  }

  return (
    <div
      className={`absolute top-0 left-0 w-full h-full pointer-events-none ${className ?? ""}`}
    >
      {markers.map((marker) => {
        // Transform marker position from pattern space to screen space
        const screenPos = transformPoint(marker.position, combinedTransform);

        const xEdge = transformPoint(
          {
            x: marker.position.x + markerSizePts,
            y: marker.position.y,
          },
          combinedTransform,
        );
        const yEdge = transformPoint(
          {
            x: marker.position.x,
            y: marker.position.y + markerSizePts,
          },
          combinedTransform,
        );
        const markerSizePx =
          (Math.hypot(xEdge.x - screenPos.x, xEdge.y - screenPos.y) +
            Math.hypot(yEdge.x - screenPos.x, yEdge.y - screenPos.y)) /
          2;

        const isHovered = hoveredMarkerId === marker.id;
        const isSelected = selectedMarkerId === marker.id;

        const displaySize = markerSizePx;

        const handlePointerDown = isInteractive
          ? (e: React.PointerEvent<HTMLDivElement>) => {
              e.preventDefault();
              e.stopPropagation();
              if (onSelectMarker) {
                onSelectMarker(marker.id);
              }
              if (onMoveMarker) {
                try {
                  const screenToPattern = inverse(combinedTransform);
                  dragState.current = {
                    markerId: marker.id,
                    startPointer: { x: e.clientX, y: e.clientY },
                    startPosition: { ...marker.position },
                    screenToPattern,
                  };
                } catch {
                  // If the transform is not invertible, dragging is not possible.
                  dragState.current = null;
                }
                e.currentTarget.setPointerCapture(e.pointerId);
              }
            }
          : undefined;

        const handlePointerMove = isInteractive
          ? (e: React.PointerEvent<HTMLDivElement>) => {
              if (
                !dragState.current ||
                dragState.current.markerId !== marker.id
              ) {
                return;
              }
              if (e.buttons === 0) {
                // Mouse button was released without a pointerup event; end the drag.
                dragState.current = null;
                return;
              }
              e.stopPropagation();

              // Convert pointer positions to pattern space via the stored inverse transform,
              // then compute the delta from the drag start to move the marker accordingly.
              const startPatternPos = transformPoint(
                dragState.current.startPointer,
                dragState.current.screenToPattern,
              );
              const currentPatternPos = transformPoint(
                { x: e.clientX, y: e.clientY },
                dragState.current.screenToPattern,
              );
              const newPosition: Point = {
                x:
                  dragState.current.startPosition.x +
                  (currentPatternPos.x - startPatternPos.x),
                y:
                  dragState.current.startPosition.y +
                  (currentPatternPos.y - startPatternPos.y),
              };
              if (onMoveMarker) {
                onMoveMarker(marker.id, newPosition);
              }
            }
          : undefined;

        const handlePointerUp = isInteractive
          ? (e: React.PointerEvent<HTMLDivElement>) => {
              if (dragState.current?.markerId === marker.id) {
                dragState.current = null;
                e.currentTarget.releasePointerCapture(e.pointerId);
              }
            }
          : undefined;

        return (
          <div
            key={marker.id}
            className={`absolute${isInteractive ? " pointer-events-auto" : ""}${isHovered || isSelected ? " cursor-grab" : ""}`}
            style={{
              left: screenPos.x - displaySize / 2,
              top: screenPos.y - displaySize / 2,
              width: displaySize,
              height: displaySize,
              // Apply theme filter to invert colors when in dark mode
              filter: themeRecolourFilter(theme),
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerEnter={
              isInteractive ? () => setHoveredMarkerId(marker.id) : undefined
            }
            onPointerLeave={
              isInteractive ? () => setHoveredMarkerId(null) : undefined
            }
          >
            <svg viewBox="0 0 100 100" width="100%" height="100%">
              {/* Background circle — white normally, secondary colour when hovered or selected */}
              <circle
                cx="50"
                cy="50"
                r="48"
                fill={isHovered || isSelected ? accentColor : "white"}
              />
              {/* Outer ring */}
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke={isHovered || isSelected ? "white" : accentColor}
                strokeWidth="8"
                strokeDasharray={isHovered && !isSelected ? "14 8" : undefined}
              />
              {/* Checkmark */}
              <path
                d="M28 50 L44 66 L72 34"
                fill="none"
                stroke={isHovered || isSelected ? "white" : accentColor}
                strokeWidth="10"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        );
      })}
    </div>
  );
}
