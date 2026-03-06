import { useTranslations } from "next-intl";
import { IconButton } from "@/_components/buttons/icon-button";
import RotateToHorizontalIcon from "@/_icons/rotate-to-horizontal";
import { visible } from "@/_components/theme/css-functions";
import Tooltip from "@/_components/tooltip/tooltip";
import KeyboardArrowRightIcon from "@/_icons/keyboard-arrow-right";
import DeleteIcon from "@/_icons/delete-icon";
import {
  useTransformContext,
  useTransformerContext,
} from "@/_hooks/use-transform-context";
import { Dispatch, SetStateAction, useState, useRef, useEffect } from "react";
import { Point } from "@/_lib/point";
import FlipHorizontalIcon from "@/_icons/flip-horizontal-icon";
import KeyboardArrowLeftIcon from "@/_icons/keyboard-arrow-left";
import ShiftIcon from "@/_icons/shift-icon";
import { subtract } from "@/_lib/point";
import { MenuStates, sideMenuOpen } from "@/_lib/menu-states";
import removeNonDigits from "@/_lib/remove-non-digits";
import { Unit } from "@/_lib/unit";
import {
  Line,
  LinesAction,
  createLine,
  transformLine,
} from "@/_reducers/linesReducer";
import InlineInput from "@/_components/inline-input";
import { useKeyDown } from "@/_hooks/use-key-down";
import { KeyCode } from "@/_lib/key-code";
import Modal from "@/_components/modal/modal";
import ModalContent from "@/_components/modal/modal-content";
import { ModalTitle } from "@/_components/modal/modal-title";
import { ModalActions } from "@/_components/modal/modal-actions";
import { Button } from "@/_components/buttons/button";
import { CSS_PIXELS_PER_INCH } from "@/_lib/pixels-per-inch";
import OffsetLinesIcon from "@/_icons/offset-lines-icon";

const OFFSET_STORAGE_KEY = "patternProjectorLastOffsetCm";
const DEFAULT_OFFSET_CM = 1.5;

function getLastOffsetCm(): number {
  try {
    const stored = localStorage.getItem(OFFSET_STORAGE_KEY);
    if (stored) {
      const value = parseFloat(stored);
      if (!isNaN(value) && value > 0) return value;
    }
  } catch {
    // localStorage not available
  }
  return DEFAULT_OFFSET_CM;
}

function saveLastOffsetCm(cm: number) {
  try {
    localStorage.setItem(OFFSET_STORAGE_KEY, String(cm));
  } catch {
    // localStorage not available
  }
}

function cmToUnit(cm: number, unit: Unit): string {
  if (unit === Unit.CM) return cm.toFixed(2);
  return (cm / 2.54).toFixed(3);
}

function unitToCm(value: string, unit: Unit): number {
  const n = parseFloat(value);
  if (isNaN(n)) return DEFAULT_OFFSET_CM;
  if (unit === Unit.CM) return n;
  return n * 2.54;
}

export default function LineMenu({
  selectedLine,
  setSelectedLine,
  lines,
  handleDeleteLine,
  gridCenter,
  setMeasuring,
  menusHidden,
  menuStates,
  unitOfMeasure,
  dispatchLines,
  pushLinesSnapshot,
}: {
  selectedLine: number;
  setSelectedLine: Dispatch<SetStateAction<number>>;
  lines: Line[];
  handleDeleteLine: () => void;
  gridCenter: Point;
  setMeasuring: Dispatch<SetStateAction<boolean>>;
  menusHidden: boolean;
  menuStates: MenuStates;
  unitOfMeasure: Unit;
  dispatchLines: Dispatch<LinesAction>;
  pushLinesSnapshot: () => void;
}) {
  const t = useTranslations("MeasureCanvas");
  const transformer = useTransformerContext();
  const transform = useTransformContext();

  const selected = selectedLine >= 0 ? lines[selectedLine] : undefined;
  const matLine = selected !== undefined ? getMatLine(selectedLine) : undefined;

  function getMatLine(i: number): Line {
    return transformLine(lines[i], transform);
  }

  function Action({
    description,
    Icon,
    onClick,
  }: {
    description: string;
    Icon: (props: { ariaLabel: string }) => JSX.Element;
    onClick: () => void;
  }) {
    return (
      <Tooltip description={description}>
        <IconButton
          border={true}
          onClick={() => {
            onClick();
            setMeasuring(false);
          }}
        >
          <Icon ariaLabel={description} />
        </IconButton>
      </Tooltip>
    );
  }

  const grainLine = createLine(
    gridCenter,
    {
      x: gridCenter.x + 1,
      y: gridCenter.y,
    },
    unitOfMeasure,
  );

  const isMenuAtBottom = menuStates.menuPosition === "bottom";

  const [showOffsetDialog, setShowOffsetDialog] = useState(false);
  const [offsetInput, setOffsetInput] = useState("");
  const offsetInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showOffsetDialog && offsetInputRef.current) {
      offsetInputRef.current.focus();
      offsetInputRef.current.select();
    }
  }, [showOffsetDialog]);

  function openOffsetDialog() {
    if (selectedLine < 0) return;
    setOffsetInput(cmToUnit(getLastOffsetCm(), unitOfMeasure));
    setShowOffsetDialog(true);
  }

  function applyOffset() {
    if (!selected) return;
    const offsetCm = unitToCm(offsetInput, unitOfMeasure);
    if (isNaN(offsetCm) || offsetCm <= 0) return;
    saveLastOffsetCm(offsetCm);
    pushLinesSnapshot();
    const offsetPx = (offsetCm / 2.54) * CSS_PIXELS_PER_INCH;
    const p0 = selected.points[0];
    const p1 = selected.points[1];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;
    const nx = -dy / len;
    const ny = dx / len;
    dispatchLines({
      type: "add",
      line: createLine(
        { x: p0.x + nx * offsetPx, y: p0.y + ny * offsetPx },
        { x: p1.x + nx * offsetPx, y: p1.y + ny * offsetPx },
        unitOfMeasure,
      ),
    });
    dispatchLines({
      type: "add",
      line: createLine(
        { x: p0.x - nx * offsetPx, y: p0.y - ny * offsetPx },
        { x: p1.x - nx * offsetPx, y: p1.y - ny * offsetPx },
        unitOfMeasure,
      ),
    });
    setShowOffsetDialog(false);
  }

  useKeyDown(() => {
    openOffsetDialog();
  }, [KeyCode.KeyO]);

  return (
    selected && (
      <>
        <menu
          className={`absolute z-40 justify-center items-center ${sideMenuOpen(menuStates) ? "left-80" : "left-16"} ${isMenuAtBottom ? "bottom-16" : "top-16"} flex gap-2 p-2 ${visible(selectedLine >= 0 && !menusHidden)}`}
        >
          <div className="flex flex-col items-center">
            <span>{lines.length}</span>
            <span>{lines.length === 1 ? t("line") : t("lines")}</span>
          </div>
          <Action
            description={t("deleteLine")}
            Icon={DeleteIcon}
            onClick={handleDeleteLine}
          />
          <Action
            description={t("rotateToHorizontal")}
            Icon={RotateToHorizontalIcon}
            onClick={() => {
              if (matLine) {
                transformer.align(matLine, grainLine);
              }
            }}
          />
          <Action
            description={t("rotateAndCenterPrevious")}
            Icon={KeyboardArrowLeftIcon}
            onClick={() => {
              if (lines.length > 0) {
                const previous =
                  selectedLine <= 0 ? lines.length - 1 : selectedLine - 1;
                setSelectedLine(previous);
                transformer.align(getMatLine(previous), grainLine);
              }
            }}
          />
          <Action
            description={t("rotateAndCenterNext")}
            Icon={KeyboardArrowRightIcon}
            onClick={() => {
              if (lines.length > 0) {
                const next =
                  selectedLine + 1 >= lines.length ? 0 : selectedLine + 1;
                setSelectedLine(next);
                transformer.align(getMatLine(next), grainLine);
              }
            }}
          />
          <Action
            description={t("flipAlong")}
            Icon={FlipHorizontalIcon}
            onClick={() => {
              if (matLine) {
                transformer.flipAlong(matLine);
              }
            }}
          />
          <Action
            description={t("translate")}
            Icon={ShiftIcon}
            onClick={() => {
              if (matLine) {
                transformer.translate(
                  subtract(matLine.points[1], matLine.points[0]),
                );
                if (selected) {
                  dispatchLines({
                    type: "update-both-points",
                    index: selectedLine,
                    newP0: selected.points[1],
                    newP1: selected.points[0],
                  });
                }
              }
            }}
          />{" "}
          <Action
            description={t("offsetLines")}
            Icon={OffsetLinesIcon}
            onClick={openOffsetDialog}
          />{" "}
          <InlineInput
            className="relative flex flex-col w-20"
            inputClassName="pl-1.5 pr-7 !border-2 !border-black dark:!border-white"
            handleChange={(e) => {
              const newDistance = removeNonDigits(
                e.target.value,
                selected.distance,
              );
              dispatchLines({
                type: "update-distance",
                index: selectedLine,
                newDistance,
              });
            }}
            id="distance"
            labelRight={unitOfMeasure.toLocaleLowerCase()}
            name="distance"
            value={selected.distance}
            type="string"
          />
          <InlineInput
            className="relative flex flex-col w-14"
            inputClassName="pl-1.5 !border-2 !border-black dark:!border-white"
            handleChange={(e) => {
              const inputValue = e.target.value;
              let newAngle;

              if (inputValue === "") {
                newAngle = "";
              } else {
                const numValue = parseInt(inputValue);
                if (!isNaN(numValue) && numValue >= 0 && numValue <= 360) {
                  newAngle = String(numValue);
                } else {
                  return;
                }
              }
              dispatchLines({
                type: "update-angle",
                index: selectedLine,
                newAngle,
              });
            }}
            id="angle"
            labelRight="°"
            name="angle"
            value={selected.angle}
            type="string"
          />
        </menu>
        <Modal open={showOffsetDialog}>
          <ModalTitle>{t("offsetLines")}</ModalTitle>
          <ModalContent>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t("offsetDistance")} ({unitOfMeasure.toLocaleLowerCase()})
            </label>
            <input
              type="number"
              min="0"
              step="0.1"
              className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-white"
              value={offsetInput}
              onChange={(e) => setOffsetInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyOffset();
                if (e.key === "Escape") setShowOffsetDialog(false);
              }}
              ref={offsetInputRef}
            />
          </ModalContent>
          <ModalActions>
            <Button onClick={applyOffset}>{t("offsetApply")}</Button>
            <Button onClick={() => setShowOffsetDialog(false)}>
              {t("cancel")}
            </Button>
          </ModalActions>
        </Modal>
      </>
    )
  );
}
