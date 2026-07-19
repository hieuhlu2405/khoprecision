"use client";

import { useEffect } from "react";

export default function NumberInputSafetyGuard() {
  useEffect(() => {
    const isNumberInput = (target: EventTarget | null): target is HTMLInputElement => (
      target instanceof HTMLInputElement && target.type === "number"
    );

    const preventArrowStep = (event: KeyboardEvent) => {
      if (!isNumberInput(event.target)) return;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") event.preventDefault();
    };

    const preventWheelStep = (event: WheelEvent) => {
      if (!isNumberInput(event.target)) return;
      if (document.activeElement === event.target) event.target.blur();
    };

    document.addEventListener("keydown", preventArrowStep, true);
    document.addEventListener("wheel", preventWheelStep, true);
    return () => {
      document.removeEventListener("keydown", preventArrowStep, true);
      document.removeEventListener("wheel", preventWheelStep, true);
    };
  }, []);

  return null;
}
