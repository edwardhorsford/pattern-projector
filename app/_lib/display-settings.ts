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
