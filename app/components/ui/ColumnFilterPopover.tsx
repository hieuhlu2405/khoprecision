"use client";

import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

type Position = {
  left: number;
  top: number;
  maxHeight: number;
};

const subscribeToClient = () => () => undefined;

export function ColumnFilterPopover({
  anchorRef,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const mounted = useSyncExternalStore(subscribeToClient, () => true, () => false);
  const [position, setPosition] = useState<Position | null>(null);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const popover = popoverRef.current;
    if (!anchor || !popover) return;

    const edge = 8;
    const gap = 8;
    const anchorRect = anchor.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const popoverWidth = popover.offsetWidth;
    const popoverHeight = popover.offsetHeight;

    const left = Math.min(
      Math.max(edge, anchorRect.left),
      Math.max(edge, viewportWidth - popoverWidth - edge),
    );

    const roomBelow = viewportHeight - anchorRect.bottom - gap - edge;
    const roomAbove = anchorRect.top - gap - edge;
    const openAbove = roomBelow < popoverHeight && roomAbove > roomBelow;
    const top = openAbove
      ? Math.max(edge, anchorRect.top - Math.min(popoverHeight, roomAbove) - gap)
      : Math.max(edge, anchorRect.bottom + gap);

    setPosition({
      left,
      top,
      maxHeight: Math.max(120, openAbove ? roomAbove : roomBelow),
    });
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!mounted) return;

    updatePosition();
    const positionFrame = window.requestAnimationFrame(updatePosition);
    const visualViewport = window.visualViewport;

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    visualViewport?.addEventListener("resize", updatePosition);
    visualViewport?.addEventListener("scroll", updatePosition);

    return () => {
      window.cancelAnimationFrame(positionFrame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      visualViewport?.removeEventListener("resize", updatePosition);
      visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [mounted, updatePosition]);

  useEffect(() => {
    if (!position) return;

    // Wait until the click that opened the popup has fully finished. Focusing
    // during that click can be undone when React replaces the clicked header.
    const focusFrame = window.requestAnimationFrame(() => {
      const focusTarget = popoverRef.current?.querySelector<HTMLElement>("[data-filter-autofocus]");
      focusTarget?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(focusFrame);
  }, [position]);

  if (!mounted) return null;

  return createPortal(
    <div
      ref={popoverRef}
      className="column-filter-popover"
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        maxHeight: position?.maxHeight,
        visibility: position ? "visible" : "hidden",
      }}
      onClick={event => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
