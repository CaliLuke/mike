"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function PreResponseWrapper({
  children,
  stepCount,
  shouldMinimize,
  isStreaming,
  compact = false,
}: {
  children: React.ReactNode;
  stepCount: number;
  shouldMinimize: boolean;
  isStreaming: boolean;
  /** Tighter typography + child gap for narrow side panels (e.g. TR chat). */
  compact?: boolean;
}) {
  const [userToggled, setUserToggled] = useState(false);
  const [isOpen, setIsOpen] = useState(!shouldMinimize);
  // Once content has streamed in (shouldMinimize=true even once), stay
  // minimized even if a later render briefly evaluates shouldMinimize=false.
  // Without this latch, the wrapper visibly pops open when isStreaming
  // flips off at the end of the response.
  const hasMinimizedRef = useRef(shouldMinimize);

  useEffect(() => {
    if (shouldMinimize) hasMinimizedRef.current = true;
    if (userToggled) return;
    queueMicrotask(() => setIsOpen(!shouldMinimize && !hasMinimizedRef.current));
  }, [shouldMinimize, userToggled]);

  const stepWord = `step${stepCount === 1 ? "" : "s"}`;
  const label = isStreaming ? "Working" : `Completed in ${stepCount} ${stepWord}`;

  const buttonTextClass = compact ? "text-xs" : "text-sm";
  const childrenGapClass = compact ? "gap-2.5" : "gap-4";

  return (
    <div className="rounded-lg border border-gray-200 px-3 py-2">
      <button
        type="button"
        onClick={() => {
          setUserToggled(true);
          setIsOpen((v) => !v);
        }}
        className={`flex w-full items-center justify-between font-serif text-gray-500 transition-colors hover:text-gray-700 ${buttonTextClass}`}
      >
        <span className="flex min-w-0 items-baseline">
          <span className="truncate">{label}</span>
          {isStreaming && (
            <span className="ml-1 inline-flex shrink-0 items-baseline">
              <span className="mr-0.5 h-0.5 w-0.5 animate-[bounce_1.4s_infinite_0s] rounded-full bg-gray-400" />
              <span className="mr-0.5 h-0.5 w-0.5 animate-[bounce_1.4s_infinite_0.2s] rounded-full bg-gray-400" />
              <span className="h-0.5 w-0.5 animate-[bounce_1.4s_infinite_0.4s] rounded-full bg-gray-400" />
            </span>
          )}
        </span>
        <ChevronDown
          size={12}
          className={`ml-2 shrink-0 transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}
        />
      </button>
      {isOpen && <div className={`mt-3 flex flex-col ${childrenGapClass}`}>{children}</div>}
    </div>
  );
}
