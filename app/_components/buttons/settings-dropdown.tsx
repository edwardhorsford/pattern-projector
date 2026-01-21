import React, { useRef, useState } from "react";
import { IconButton } from "@/_components/buttons/icon-button";
import Tooltip from "@/_components/tooltip/tooltip";
import { visible } from "@/_components/theme/css-functions";
import useOnClickOutside from "@/_hooks/use-on-click-outside";
import { MenuPosition, MenuStates } from "@/_lib/menu-states";
import { useTranslations } from "next-intl";
import SettingsIcon from "@/_icons/settings-icon";
import { Dispatch, SetStateAction } from "react";
import { useLocale } from "next-intl";

export function SettingsDropdown({
  menuStates,
  setMenuStates,
  isMenuAtBottom,
}: {
  menuStates: MenuStates;
  setMenuStates: Dispatch<SetStateAction<MenuStates>>;
  isMenuAtBottom: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const t = useTranslations("SettingsMenu");
  const locale = useLocale();

  useOnClickOutside(containerRef, () => setIsOpen(false));

  const handlePositionChange = (position: MenuPosition) => {
    const newMenuStates = { ...menuStates, menuPosition: position };
    setMenuStates(newMenuStates);
    localStorage.setItem("menuPosition", position);
  };

  const dropdownClasses = isMenuAtBottom
    ? "absolute right-0 bottom-full mb-2 min-w-max bg-white dark:bg-gray-800 rounded-md shadow-lg z-10"
    : "absolute right-0 mt-2 min-w-max bg-white dark:bg-gray-800 rounded-md shadow-lg z-10";

  return (
    <div className="relative inline-block" ref={containerRef}>
      <Tooltip description={t("title")} disabled={isOpen} top={isMenuAtBottom}>
        <IconButton
          onClick={() => setIsOpen(!isOpen)}
          aria-haspopup="true"
          aria-expanded={isOpen}
          active={isOpen}
        >
          <SettingsIcon ariaLabel={t("title")} />
        </IconButton>
      </Tooltip>
      <div
        className={`${dropdownClasses} ${visible(isOpen)} p-3`}
        tabIndex={-1}
        role="menu"
      >
        <div className="flex items-center justify-between gap-4">
          <label
            htmlFor="menu-position-select"
            className="text-sm font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap"
          >
            {t("menuPosition")}
          </label>
          <select
            id="menu-position-select"
            value={menuStates.menuPosition}
            onChange={(e) => handlePositionChange(e.target.value as MenuPosition)}
            className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          >
            <option value="top">{t("top")}</option>
            <option value="bottom">{t("bottom")}</option>
          </select>
        </div>
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
          <button
            onClick={() => {
              window.open(
                `/${locale}/control`,
                "controlPanel",
                "width=400,height=600,menubar=no,toolbar=no,location=no,status=no"
              );
              setIsOpen(false);
            }}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors w-full"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
            {t("controlPanel")}
          </button>
        </div>
      </div>
    </div>
  );
}
