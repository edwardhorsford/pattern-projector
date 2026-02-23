export interface OverlaySettings {
  disabled: boolean;
  grid: boolean;
  border: boolean;
  paper: boolean;
  flipLines: boolean;
  flippedPattern: boolean;
}

export function getDefaultOverlaySettings() {
  return {
    disabled: false,
    grid: false,
    border: false,
    paper: false,
    flipLines: false,
    flippedPattern: true,
  };
}

export enum Theme {
  Light = "Light",
  Dark = "Dark",
  Green = "Green",
  Cyan = "Cyan",
  Amber = "Amber",
  Magenta = "Magenta",
}

export interface ThemePalette {
  primary: string;
  secondary: string;
  tertiary: string;
  filter: string;
  fill: string;
  dark: boolean;
}

const THEME_ORDER: Theme[] = [
  Theme.Light,
  Theme.Green,
  Theme.Dark,
  Theme.Cyan,
  Theme.Amber,
  Theme.Magenta,
];

const THEME_PALETTES: Record<Theme, ThemePalette> = {
  [Theme.Light]: {
    primary: "#000000",
    secondary: "#9333EA",
    tertiary: "#FF4500",
    filter: "none",
    fill: "#ffffff",
    dark: false,
  },
  [Theme.Dark]: {
    primary: "#ffffff",
    secondary: "#9333EA",
    tertiary: "#FF4500",
    // invert only — Dark theme wants pure white lines.
    filter: "invert(1)",
    fill: "#000000",
    dark: true,
  },
  [Theme.Green]: {
    primary: "#75FFCD",
    secondary: "#9333EA",
    tertiary: "#FF4500",
    // Colour themes use the feColorMatrix recolour pipeline instead of CSS filter strings.
    // The 'filter' field is unused for colour themes — themeRecolourFilter() returns
    // the push-darks + recolour chain instead.
    filter: "none",
    fill: "#000000",
    dark: true,
  },
  [Theme.Cyan]: {
    primary: "#7DEBFF",
    secondary: "#9333EA",
    tertiary: "#FF4500",
    filter: "none",
    fill: "#000000",
    dark: true,
  },
  [Theme.Amber]: {
    primary: "#FFD17A",
    secondary: "#9333EA",
    tertiary: "#FF4500",
    filter: "none",
    fill: "#000000",
    dark: true,
  },
  [Theme.Magenta]: {
    primary: "#fc46aa",
    secondary: "#9333EA",
    tertiary: "#FF4500",
    filter: "none",
    fill: "#000000",
    dark: true,
  },
};

export interface DisplaySettings {
  theme: Theme;
  overlay: OverlaySettings;
  /** Brightness multiplier for recoloured themes (0.1–2.0).
   * 1.0 = theme primary colour at full intensity.
   * < 1.0 = dimmer, > 1.0 = brighter (can wash out).
   * Default 1.0.
   */
  brightness: number;
}

export function getDefaultDisplaySettings() {
  return {
    theme: Theme.Light,
    overlay: getDefaultOverlaySettings(),
    brightness: 1.0,
  };
}

export function themes() {
  return THEME_ORDER;
}

export function themePalette(theme: Theme): ThemePalette {
  return THEME_PALETTES[theme];
}

export function isDarkTheme(theme: Theme) {
  return themePalette(theme).dark;
}

/**
 * Returns the CSS filter string for rendering content in the theme colour.
 * For colour themes (Green, Cyan, etc.) this includes push-darks and contrast
 * before the feColorMatrix recolour filter, matching the main rendering pipeline.
 * For non-colour themes (Light, Dark) this returns the legacy filter string.
 */
export function themeRecolourFilter(theme: Theme): string {
  if (isColourTheme(theme)) {
    return "url(#push-darks) contrast(1.5) url(#recolor)";
  }
  return themePalette(theme).filter;
}

export function strokeColor(theme: Theme) {
  return themePalette(theme).primary;
}

export function fillColor(theme: Theme) {
  return themePalette(theme).fill;
}

export function secondaryColor(theme: Theme) {
  return themePalette(theme).secondary;
}

export function tertiaryColor(theme: Theme) {
  return themePalette(theme).tertiary;
}

/** Returns true for colour themes (Green, Cyan, Amber, Magenta) that use the recolour pipeline. */
export function isColourTheme(theme: Theme): boolean {
  return (
    theme === Theme.Green ||
    theme === Theme.Cyan ||
    theme === Theme.Amber ||
    theme === Theme.Magenta
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  const normalized =
    value.length === 3
      ? `${value[0]}${value[0]}${value[1]}${value[1]}${value[2]}${value[2]}`
      : value;
  const parsed = Number.parseInt(normalized, 16);

  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255,
  };
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }) {
  const toHex = (component: number) =>
    clamp(Math.round(component), 0, 255).toString(16).padStart(2, "0");

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Applies a brightness multiplier to a hex colour.
 * brightness 1.0 = unchanged, 0.5 = half intensity, 2.0 = double (clamped to 255).
 */
export function applyBrightness(hex: string, brightness: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex({
    r: r * brightness,
    g: g * brightness,
    b: b * brightness,
  });
}

function mixHex(baseHex: string, mixHexColor: string, ratio: number) {
  const amount = clamp(ratio, 0, 1);
  const base = hexToRgb(baseHex);
  const mix = hexToRgb(mixHexColor);

  return rgbToHex({
    r: base.r + (mix.r - base.r) * amount,
    g: base.g + (mix.g - base.g) * amount,
    b: base.b + (mix.b - base.b) * amount,
  });
}

function overlayBaseColor(theme: Theme) {
  const baseSecondary = secondaryColor(theme);
  if (isDarkTheme(theme)) {
    return mixHex(baseSecondary, "#ffffff", 0.12);
  }

  return mixHex(baseSecondary, "#000000", 0.02);
}

export function overlayGridColor(theme: Theme, isMajorLine: boolean) {
  const base = overlayBaseColor(theme);
  if (isDarkTheme(theme)) {
    return mixHex(base, "#ffffff", isMajorLine ? 0.52 : 0.38);
  }

  return mixHex(base, "#000000", isMajorLine ? 0.34 : 0.24);
}

export function overlayPaperStrokeColor(theme: Theme) {
  const base = overlayBaseColor(theme);
  if (isDarkTheme(theme)) {
    return mixHex(base, "#ffffff", 0.45);
  }

  return mixHex(base, "#000000", 0.22);
}

export function overlayPaperLabelColor(theme: Theme) {
  const base = overlayBaseColor(theme);
  if (isDarkTheme(theme)) {
    return mixHex(base, "#ffffff", 0.55);
  }

  return mixHex(base, "#000000", 0.3);
}
