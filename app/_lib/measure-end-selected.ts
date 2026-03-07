// measure-end-selected.ts
// Shared mutable flag used to signal that a measurement line endpoint is
// currently selected for arrow-key nudging. Read by useProgArrowKeyToMatrix
// to suppress canvas panning while nudging is active.
export const measureEndSelectedRef = { current: false };
