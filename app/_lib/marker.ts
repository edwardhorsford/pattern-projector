import { Point } from "@/_lib/point";

/**
 * A marker placed on the pattern to indicate a completed section.
 * Positions are stored in PDF coordinate space (points).
 */
export interface Marker {
  /** Unique identifier for the marker */
  id: string;
  /** Position in PDF coordinates (points) */
  position: Point;
  /** Timestamp when the marker was created */
  createdAt: number;
}

/**
 * Generate a unique ID for a new marker
 */
export function generateMarkerId(): string {
  return `marker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a new marker at the given position
 */
export function createMarker(position: Point): Marker {
  return {
    id: generateMarkerId(),
    position,
    createdAt: Date.now(),
  };
}

/**
 * Default marker size in inches (will be converted to PDF points for rendering)
 */
export const MARKER_SIZE_INCHES = 4;
