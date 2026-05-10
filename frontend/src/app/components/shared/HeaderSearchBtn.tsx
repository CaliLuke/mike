"use client";

import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export function HeaderSearchBtn({ value, onChange, placeholder = "Search…" }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        onChange("");
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, onChange]);

  return (
    <div ref={ref} className="relative flex items-center">
      {open ? (
        <div className="absolute top-1/2 right-0 z-10 flex w-72 -translate-y-1/2 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 shadow-sm">
          <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          <input
            autoFocus
            type="text"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"
          />
          <button
            onClick={() => {
              setOpen(false);
              onChange("");
            }}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center justify-center p-1.5 text-gray-500 transition-colors hover:text-gray-900"
        >
          <Search className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
