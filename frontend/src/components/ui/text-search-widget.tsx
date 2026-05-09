import { ArrowDown, ArrowUp } from "lucide-react";
import { useRef } from "react";

import { Input } from "@/components/ui/input";

interface TextSearchWidgetProps {
  isOpen: boolean;
  onClose: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  currentMatchIdx: number;
  matchCount: number;
  setCurrentMatchIdx: (idx: number | ((prev: number) => number)) => void;
  className?: string;
}

export function TextSearchWidget({
  isOpen,
  onClose,
  searchQuery,
  onSearchChange,
  currentMatchIdx,
  matchCount,
  setCurrentMatchIdx,
  className = "",
}: TextSearchWidgetProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleNext = () => {
    if (matchCount === 0) return;
    setCurrentMatchIdx((prev) => (prev + 1) % matchCount);
  };

  const handlePrev = () => {
    if (matchCount === 0) return;
    setCurrentMatchIdx((prev) => (prev - 1 + matchCount) % matchCount);
  };

  if (!isOpen) return null;

  return (
    <div
      className={`flex min-w-[300px] flex-col overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg ${className}`}
    >
      <div className="flex items-center gap-1 p-1">
        <div className="relative flex-1">
          <Input
            ref={searchInputRef}
            autoFocus
            placeholder="Find"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-8 w-full rounded-sm border-gray-200 bg-gray-100/50 pr-[80px] text-sm placeholder:text-gray-500 focus-visible:border-blue-600 focus-visible:ring-0"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onClose();
                onSearchChange("");
              } else if (e.key === "Enter") {
                if (e.shiftKey) handlePrev();
                else handleNext();
              }
            }}
          />
        </div>
      </div>

      {/* Results count and navigation */}
      {searchQuery && (
        <div className="flex items-center justify-between px-2 pt-0.5 pb-1 text-xs text-gray-500">
          <span>{matchCount > 0 ? `${currentMatchIdx + 1} of ${matchCount}` : "No results"}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={handlePrev}
              disabled={matchCount === 0}
              className="rounded p-1 hover:bg-gray-100 disabled:opacity-50"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <button
              onClick={handleNext}
              disabled={matchCount === 0}
              className="rounded p-1 hover:bg-gray-100 disabled:opacity-50"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
