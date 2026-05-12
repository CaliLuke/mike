"use client";

import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface RowMenuItem {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  /** Renders the item in red and surfaces it as a destructive action. */
  destructive?: boolean;
  disabled?: boolean;
  /** Hide the item without removing it from the list. */
  hidden?: boolean;
}

interface Props {
  items: RowMenuItem[];
  /** ARIA label for the trigger button. */
  ariaLabel?: string;
}

/**
 * Generic row-action menu. Each table configures its own item list, so adding
 * a new action is just appending to the array — no need to grow the trigger's
 * footprint with one inline button per action.
 */
export function RowMenu({ items, ariaLabel = "Row actions" }: Props) {
  const visibleItems = items.filter((item) => !item.hidden);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick() {
      setOpen(false);
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [open]);

  if (visibleItems.length === 0) return null;

  function handleToggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen((o) => !o);
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        aria-label={ariaLabel}
        className="flex h-6 w-6 items-center justify-center rounded leading-none text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
      >
        <span className="text-xs tracking-widest">···</span>
      </button>

      {open && (
        <div
          style={{ position: "fixed", top: coords.top, right: coords.right }}
          className="z-50 w-48 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {visibleItems.map((item, idx) => {
            const Icon = item.icon;
            const base =
              "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors disabled:opacity-40";
            const tone = item.destructive
              ? "text-red-500 hover:bg-red-50"
              : "text-gray-600 hover:bg-gray-50";
            return (
              <button
                key={idx}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                disabled={item.disabled}
                className={`${base} ${tone}`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
