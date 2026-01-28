"use client";

import React from "react";
import { Marker, MARKER_SIZE_INCHES } from "@/_lib/marker";
import { useTransformContext } from "@/_hooks/use-transform-context";
import Matrix from "ml-matrix";
import { getPtDensity, Unit } from "@/_lib/unit";
import { Theme, themeFilter } from "@/_lib/display-settings";

interface MarkerCanvasProps {
  markers: Marker[];
  calibrationTransform: Matrix;
  unitOfMeasure: Unit;
  theme?: Theme;
  className?: string;
}

/**
 * Helper to transform a point from PDF space to screen space
 */
function transformPoint(
  x: number,
  y: number,
  transform: Matrix
): { x: number; y: number } {
  // Apply the 3x3 transformation matrix
  const m = transform.to1DArray();
  const newX = m[0] * x + m[1] * y + m[2];
  const newY = m[3] * x + m[4] * y + m[5];
  return { x: newX, y: newY };
}

/**
 * Renders markers (checkmarks) on the pattern.
 * Markers are positioned in PDF coordinates and transformed to screen space.
 * The markers themselves remain upright (not rotated/flipped with the pattern).
 */
export default function MarkerCanvas({
  markers,
  calibrationTransform,
  unitOfMeasure,
  theme = Theme.Light,
  className,
}: MarkerCanvasProps) {
  const localTransform = useTransformContext();
  
  // Calculate marker size in screen pixels
  // Use calibration transform to get the scale factor (points to pixels)
  const ptDensity = getPtDensity(unitOfMeasure);
  const markerSizePts = MARKER_SIZE_INCHES * ptDensity;
  
  // Combined transform for positioning markers
  const combinedTransform = calibrationTransform.mmul(localTransform);
  
  // Get scale from combined transform to size markers appropriately
  const m = combinedTransform.to1DArray();
  const scaleX = Math.sqrt(m[0] * m[0] + m[3] * m[3]);
  const markerSizePx = markerSizePts * scaleX;

  if (markers.length === 0) {
    return null;
  }

  return (
    <div
      className={`absolute top-0 left-0 w-full h-full pointer-events-none ${className ?? ""}`}
    >
      {markers.map((marker) => {
        // Transform marker position from PDF space to screen space
        const screenPos = transformPoint(
          marker.position.x,
          marker.position.y,
          combinedTransform
        );
        
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
              filter: themeFilter(theme),
            }}
          >
            <svg
              viewBox="0 0 100 100"
              width="100%"
              height="100%"
            >
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
                stroke="#a855f7"
                strokeWidth="8"
              />
              {/* Purple checkmark */}
              <path
                d="M28 50 L44 66 L72 34"
                fill="none"
                stroke="#a855f7"
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
