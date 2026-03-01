"use client";

import React from "react";
import { Marker, MARKER_SIZE_INCHES } from "@/_lib/marker";
import { useTransformContext } from "@/_hooks/use-transform-context";
import Matrix from "ml-matrix";
import { getPtDensity, Unit } from "@/_lib/unit";
import { Theme, secondaryColor, themeRecolourFilter } from "@/_lib/display-settings";
import { scale, transformPoint } from "@/_lib/geometry";

interface MarkerCanvasProps {
  markers: Marker[];
  calibrationTransform: Matrix;
  patternScale: number;
  unitOfMeasure: Unit;
  theme?: Theme;
  className?: string;
}

/**
 * Renders markers (checkmarks) on the pattern.
 * Markers are positioned in pattern space and transformed to screen space.
 * The markers themselves remain upright (not rotated/flipped with the pattern).
 */
export default function MarkerCanvas({
  markers,
  calibrationTransform,
  patternScale,
  unitOfMeasure,
  theme = Theme.Light,
  className,
}: MarkerCanvasProps) {
  const localTransform = useTransformContext();
  const accentColor = secondaryColor(theme);

  // Calculate marker size in screen pixels
  // Use calibration transform to get the scale factor (points to pixels)
  const ptDensity = getPtDensity(unitOfMeasure);
  const markerSizePts = MARKER_SIZE_INCHES * ptDensity;

  // Combined transform for positioning markers
  const combinedTransform = calibrationTransform.mmul(
    localTransform.mmul(scale(patternScale)),
  );

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

        return (
          <div
            key={marker.id}
            className="absolute"
            style={{
              left: screenPos.x - markerSizePx / 2,
              top: screenPos.y - markerSizePx / 2,
              width: markerSizePx,
              height: markerSizePx,
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
    </div>
  );
}
