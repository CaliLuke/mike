"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { LukeIcon } from "@/components/chat/luke-icon";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/contexts/UserProfileContext";

import type { LukeMessage } from "../shared/types";
import { ChatInput } from "./ChatInput";
import { SelectAssistantProjectModal } from "./SelectAssistantProjectModal";

interface InitialViewProps {
  onSubmit: (message: LukeMessage) => void;
}

const ICON_SIZE = 35;
const GAP = 16; // gap-4 = 1rem = 16px

export function InitialView({ onSubmit }: InitialViewProps) {
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const [loaded, setLoaded] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [iconOffset, setIconOffset] = useState(0);
  const [textOffset, setTextOffset] = useState(0);
  const textRef = useRef<HTMLHeadingElement>(null);

  const username = profile?.displayName?.trim() || user?.email?.split("@")[0] || "there";

  useLayoutEffect(() => {
    if (!profile || !textRef.current) return;
    const h1Width = textRef.current.offsetWidth;
    setIconOffset((h1Width + GAP) / 2);
    setTextOffset((ICON_SIZE + GAP) / 2);
  }, [profile]);

  useEffect(() => {
    if (!iconOffset) return;
    const t = setTimeout(() => setLoaded(true), 100);
    return () => clearTimeout(t);
  }, [iconOffset]);

  return (
    <div className="flex h-full w-full flex-col px-6">
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="relative w-full max-w-4xl flex-col items-center px-0 xl:px-8">
          <div className="relative mb-10 flex items-center justify-center">
            <div
              className="absolute h-[35px]"
              style={{
                left: "50%",
                transform: loaded ? `translateX(calc(-50% - ${iconOffset}px))` : "translateX(-50%)",
                transition: "transform 900ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
              }}
            >
              <LukeIcon size={ICON_SIZE} />
            </div>
            <h1
              ref={textRef}
              className="absolute font-serif text-4xl font-light whitespace-nowrap text-gray-900"
              style={{
                left: "50%",
                transform: loaded ? `translateX(calc(-50% + ${textOffset}px))` : "translateX(-50%)",
                opacity: loaded ? 1 : 0,
                transition:
                  "transform 900ms cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 800ms ease-in-out 300ms",
              }}
            >
              Hi, {username}
            </h1>
          </div>

          <ChatInput
            onSubmit={onSubmit}
            onCancel={() => {}}
            isLoading={false}
            onProjectsClick={() => setProjectModalOpen(true)}
          />

          <div className="text-center">
            <p className="mb-3 py-3 text-xs text-gray-500">
              AI can make mistakes. Always double check their work.
            </p>
          </div>
        </div>
      </div>

      <SelectAssistantProjectModal
        open={projectModalOpen}
        onClose={() => setProjectModalOpen(false)}
      />
    </div>
  );
}
