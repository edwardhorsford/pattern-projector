import { Layers } from "./layers";

export type MenuPosition = "top" | "bottom";

export interface MenuStates {
  nav: boolean;
  layers: boolean;
  stitch: boolean;
  scale: boolean;
  settings: boolean;
  menuPosition: MenuPosition;
}

export enum SideMenuType {
  layers = "layers",
  stitch = "stitch",
  scale = "scale",
  settings = "settings",
}

export function toggleSideMenuStates(
  menuStates: MenuStates,
  menu: SideMenuType,
) {
  const visible = !menuStates[menu];
  const newMenuStates = getDefaultMenuStates();
  newMenuStates[menu] = visible;
  // Preserve the menu position setting
  newMenuStates.menuPosition = menuStates.menuPosition;
  return newMenuStates;
}

export function getDefaultMenuStates(): MenuStates {
  return {
    nav: true,
    layers: false,
    stitch: false,
    scale: false,
    settings: false,
    menuPosition: "top",
  };
}

export function getMenuStatesFromPageCount(
  menuStates: MenuStates,
  pageCount: number,
) {
  if (pageCount > 1) {
    return { ...menuStates, nav: true, layers: false, scale: false, stitch: true, settings: false };
  } else {
    return menuStates;
  }
}

export function getMenuStatesFromLayers(
  menuStates: MenuStates,
  layers: Layers,
) {
  if (menuStates.stitch) {
    return menuStates;
  } else {
    return {
      ...menuStates,
      nav: true,
      stitch: false,
      scale: false,
      settings: false,
      layers: Object.keys(layers).length > 0,
    };
  }
}

export function sideMenuOpen(menuStates: MenuStates) {
  for (const m in SideMenuType) {
    if (menuStates[m as SideMenuType]) {
      return true;
    }
  }
  return false;
}
