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
    filter: "invert(1)",
    fill: "#000000",
    dark: true,
  },
  [Theme.Green]: {
    primary: "#75FFCD",
    secondary: "#9333EA",
    tertiary: "#FF4500",
    filter: "invert(1) sepia(100%) saturate(300%) hue-rotate(80deg)",
    fill: "#000000",
    dark: true,
  },
  [Theme.Cyan]: {
    primary: "#7DEBFF",
    secondary: "#9333EA",
    tertiary: "#FF4500",
    filter: "invert(1) sepia(100%) saturate(280%) hue-rotate(135deg)",
    fill: "#000000",
    dark: true,
  },
  [Theme.Amber]: {
    primary: "#FFD17A",
    secondary: "#9333EA",
    tertiary: "#FF4500",
    filter: "invert(1) sepia(100%) saturate(330%) hue-rotate(350deg)",
    fill: "#000000",
    dark: true,
  },
  [Theme.Magenta]: {
    primary: "#FF8DFF",
    secondary: "#9333EA",
    tertiary: "#FF4500",
    filter: "invert(1) sepia(100%) saturate(280%) hue-rotate(250deg)",
    fill: "#000000",
    dark: true,
  },
};

export interface DisplaySettings {
  theme: Theme;
  overlay: OverlaySettings;
}

export function getDefaultDisplaySettings() {
  return {
    theme: Theme.Light,
    overlay: getDefaultOverlaySettings(),
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

export function themeFilter(theme: Theme): string {
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
