# Pattern Projector

This is a fork of the excellent and popular [Pattern Projector](https://github.com/Pattern-Projector/pattern-projector).

I had a bunch of ideas for new features, and have explored them in this fork using LLMs. You're welcome to use it, but it's probably had much less testing than the source project.

## New features

### Separate control panel window

A secondary window opened from the settings menu. Lets the user control Pattern
Projector from a laptop or second screen while the main window stays on the
projector — no need to reach the projected display.

- Replicates all major controls (pan, scale, flip, rotate, re-centring, file
  loading, theme, line weight, line tool).
- Mini map showing a PDF thumbnail with a viewport indicator; click to navigate.
- Pan pad with directional buttons for nudging the pattern.

### Toolbar docked to bottom

Option in the settings dropdown to move the toolbar from the top to the bottom
of the screen. Preference persists across sessions.

### Mark complete

Place tick/checkmark overlays on the pattern to track progress while cutting.
Press `X` or use the menu. Marks stay correctly anchored under calibration and
scale changes. Undo with Cmd-Z / Ctrl-Z.

### Offset lines

Given a selected measurement line, draw two parallel lines offset by a chosen
distance — for adding seam allowance or marking extensions. Press `O` or use
the line control panel.

### Loupe view for line endpoints

A magnified loupe appears when positioning a line endpoint. Tab cycles between
ends; arrow keys give fine adjustment (Shift for 10× speed).

### High-resolution viewport overlay

Renders only the currently visible portion of each PDF page at full device
resolution, composited over the base canvas. The projected image stays sharp at
any zoom level, including in magnify mode. The overlay is lazily rendered — if
the user pans out of range the base canvas shows through briefly until it
catches up.

The improvement is most noticeable with large PDFs and when using the magnify
tool, where the high-res overlay renders the magnified area at full clarity
rather than scaling up a lower-res canvas.

## Rendering improvements

### Sharper, more accurate line rendering

- Lines that appeared faint or grey are now rendered crisp and dark.
- Line thickening (erosion) no longer blurs lines.
- Erosion results are cached per line weight and theme colour, so switching between weights is
  fast — the image is not re-processed from scratch.
- During magnify mode, erosion is reduced because the computational cost scales
  exponentially; the projected image still appears sharp at the larger zoom, reducing the need for erosion.
- Added full Safari compatibility for the rendering pipeline (Safari does not
  support SVG filter references on canvas).
- Colours now render exactly as defined — replaced the old approximate
  `invert/sepia/hue-rotate` filter chain with a direct luminance-to-colour
  mapping.
- Brightness multiplier slider replaces the old fixed lift approach.
- New colour themes: Cyan, Amber, Magenta (alongside the original Light, Dark,
  Green).

### Higher render resolution

For non-Safari browsers, the base PDF canvas is rendered at significantly higher
resolution, improving sharpness across the whole pattern.

### Rendering moved to workers

Pixel processing runs off the main thread so the UI stays responsive during
heavy renders. Each page gets its own worker, so multi-page PDFs render in
parallel.

### Rendering paused during calibration

The PDF is not re-rendered while the user is adjusting the calibration grid.
Previously, large PDFs would trigger a full re-render on every drag event,
making calibration slow and unresponsive.

## Calibration & zoom fixes

- **Drag calibration grid edges in pattern space** — previously dragging an
  edge in screen space would inadvertently distort the other corners.
- **Pinch/scroll zoom on single-page PDFs** now zooms correctly about the
  pointer location.
- **Scale and zoom zoom about the calibration/reticle centre**, not an
  arbitrary point.
- **View stays centred when changing grid size preset**.
- **Constrained (45° snap) line drawing** snaps closer to the actual cursor
  position.
- **Screen size change warning** now includes a button to immediately save the
  current calibration to the new screen size.

## Scale improvements

- Max scale increased to 10×, with non-linear steps that are usable across the
  full range.
- Keyboard shortcuts for scaling intercept browser zoom and set pattern scale
  instead.
- Scale reset button (↺) to quickly return to 1×.
- cm used as the default unit.

## Measurement / line tool improvements

- Improved line snapping — snaps to the closest grid point to the cursor.
- Increased displayed angle precision.
- Escape cancels an active tool; Backspace deletes a selected line.
- Hover effects on lines.
- Line tool disabled during magnify mode.
- Select and drag markers.
- Undo for lines, markers, and calibration grid changes (Cmd-Z / Ctrl-Z).

## Other fixes

- SVG patterns were getting clipped when zoomed.
- Various dark mode styling gaps (modals, control panel hover states).
- Stitch menu no longer auto-opens when loading a multi-page PDF.
- Reduced flashes of white during theme and scale changes.

## Developer tooling

- Debug panel (dev mode) with settings for testing calibrations, themes, grid
  sizes, and the high-res overlay.
- `/rendering-test` page for comparing filter combinations side-by-side.
- DevContainer config for GitHub Codespaces.
