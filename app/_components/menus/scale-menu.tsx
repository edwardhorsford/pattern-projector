import StepperInput from "@/_components/stepper-input";
import { Dispatch } from "react";
import removeNonDigits from "@/_lib/remove-non-digits";
import { useTranslations } from "next-intl";
import { PatternScaleAction } from "@/_reducers/patternScaleReducer";

export default function ScaleMenu({
  patternScale,
  dispatchPatternScaleAction,
  isMenuAtBottom = false,
}: {
  patternScale: string;
  dispatchPatternScaleAction: Dispatch<PatternScaleAction>;
  isMenuAtBottom?: boolean;
}) {
  const t = useTranslations("ScaleMenu");

  const menuStyles = isMenuAtBottom
    ? "flex flex-col gap-2 p-2 w-64 items-start bg-white dark:bg-black border-t border-r border-gray-200 dark:border-gray-700"
    : "flex flex-col gap-2 p-2 w-64 items-start bg-white dark:bg-black border-b border-r border-gray-200 dark:border-gray-700";

  return (
    <menu className={menuStyles}>
      <StepperInput
        inputClassName="w-20"
        handleChange={(e) =>
          dispatchPatternScaleAction({
            type: "set",
            scale: removeNonDigits(e.target.value, patternScale),
          })
        }
        label={t("scale")}
        value={patternScale}
        onStep={(delta) =>
          dispatchPatternScaleAction({ type: "delta", delta: delta })
        }
        step={0.1}
      ></StepperInput>
    </menu>
  );
}
