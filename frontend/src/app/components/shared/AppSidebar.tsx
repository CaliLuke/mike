"use client";

import {
  Building2,
  ChevronDown,
  ChevronsUpDown,
  FileText,
  FolderOpen,
  Library,
  MessageSquare,
  PanelLeft,
  Table2,
  User,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { SidebarChatItem } from "@/app/components/shared/SidebarChatItem";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import { listApplications, listCompanies, listDocuments } from "@/app/lib/lukeApi";
import { getTracer } from "@/app/lib/telemetry";
import { LukeIcon } from "@/components/chat/luke-icon";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/contexts/UserProfileContext";

const NAV_ITEMS = [
  { href: "/assistant", label: "Assistant", icon: MessageSquare },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/applications", label: "Applications", icon: FolderOpen },
  { href: "/files", label: "Files", icon: FileText },
  { href: "/tabular-reviews", label: "Tabular Review", icon: Table2 },
  { href: "/workflows", label: "Workflows", icon: Library },
];

interface AppSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function AppSidebar({ isOpen, onToggle }: AppSidebarProps) {
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const { chats, currentChatId, setCurrentChatId } = useChatHistoryContext();
  const router = useRouter();
  const pathname = usePathname();
  const [shouldAnimate, setShouldAnimate] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [applicationNames, setApplicationNames] = useState<Record<string, string>>({});
  const [applicationCount, setApplicationCount] = useState<number | null>(null);
  const [companyCount, setCompanyCount] = useState<number | null>(null);
  const [fileCount, setFileCount] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const refresh = () => {
      Promise.all([listApplications(), listCompanies(), listDocuments()])
        .then(([applications, companies, documents]) => {
          if (cancelled) return;
          const map: Record<string, string> = {};
          for (const p of applications) map[p.id] = p.name;
          setApplicationNames(map);
          setApplicationCount(applications.length);
          setCompanyCount(companies.length);
          setFileCount(documents.length);
        })
        .catch(() => {});
    };
    refresh();
    // Poll while the sidebar is mounted so the user sees the count tick
    // up shortly after the assistant creates a new company / application.
    // 5s is plenty fast for visual feedback on a local-only app.
    const interval = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [user]);

  useEffect(() => {
    if (!isOpen) queueMicrotask(() => setShouldAnimate(true));
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = () => setIsDropdownOpen(false);
    if (isDropdownOpen) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [isDropdownOpen]);

  useEffect(() => {
    if (pathname.startsWith("/assistant/chat/")) {
      const chatId = pathname.split("/").pop() ?? null;
      setCurrentChatId(chatId);
      return;
    }

    const applicationChatMatch = pathname.match(/^\/applications\/[^/]+\/assistant\/chat\/([^/]+)/);
    if (applicationChatMatch) {
      setCurrentChatId(applicationChatMatch[1]);
      return;
    }

    if (pathname === "/assistant") {
      setCurrentChatId(null);
    }
  }, [pathname, setCurrentChatId]);

  const getUserInitials = (email: string) => {
    if (profile?.displayName) return profile.displayName.charAt(0).toUpperCase();
    return email.charAt(0).toUpperCase();
  };

  const getDisplayName = () => {
    if (!profile) return "";
    return profile.displayName || user?.email?.split("@")[0] || "";
  };

  const getUserTier = () => {
    if (!profile) return "";
    return profile.tier || "Free";
  };

  if (!user) return null;

  return (
    <div
      className={`${
        isOpen
          ? "h-dvh w-64 border-r bg-gray-50"
          : "h-auto w-14 bg-transparent md:h-dvh md:border-r md:bg-gray-50"
      } absolute z-99 flex flex-col overflow-visible border-gray-200 transition-all duration-300 md:relative`}
    >
      {/* Toggle + Logo */}
      <div
        className={`mb-3 items-center justify-between px-2.5 py-2 ${
          !isOpen ? "hidden md:flex" : "flex"
        }`}
      >
        {isOpen && (
          <div className="px-2.5">
            <Link
              href="/assistant"
              className="flex items-center gap-1.5 transition-opacity hover:opacity-80"
            >
              <LukeIcon size={22} />
              <span
                className={`font-serif text-2xl font-light ${
                  shouldAnimate ? "sidebar-fade-in" : ""
                }`}
              >
                Luke
              </span>
            </Link>
          </div>
        )}
        <button
          onClick={onToggle}
          className="flex h-9 w-9 items-center rounded-md p-2.5 transition-colors hover:bg-gray-100"
          title={isOpen ? "Close sidebar" : "Open sidebar"}
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      </div>

      {/* Nav items */}
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const isActive = pathname === href || pathname.startsWith(href + "/");
        let count: number | null = null;
        if (href === "/applications") count = applicationCount;
        else if (href === "/companies") count = companyCount;
        else if (href === "/files") count = fileCount;
        return (
          <div key={href} className="px-2.5 py-1">
            <button
              onClick={() => {
                const span = getTracer().startSpan("nav.click", {
                  attributes: {
                    "nav.href": href,
                    "nav.label": label,
                    "nav.from": pathname,
                  },
                });
                span.end();
                router.push(href);
              }}
              title={!isOpen ? `${label}${count !== null ? ` (${count})` : ""}` : ""}
              className={`flex h-9 w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
                isActive ? "bg-gray-100 text-gray-900" : "text-gray-700 hover:bg-gray-100"
              } ${!isOpen ? "hidden md:flex" : "flex"}`}
            >
              <Icon
                className={`h-4 w-4 flex-shrink-0 ${isActive ? "text-gray-900" : "text-black"}`}
              />
              {isOpen && (
                <>
                  <span
                    className={`flex-1 text-sm font-medium ${shouldAnimate ? "sidebar-fade-in-2" : ""}`}
                  >
                    {label}
                  </span>
                  {count !== null && (
                    <span
                      className={`ml-auto inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
                        isActive ? "bg-gray-200 text-gray-700" : "bg-gray-100 text-gray-500"
                      }`}
                      aria-label={`${count} ${label.toLowerCase()}`}
                    >
                      {count}
                    </span>
                  )}
                </>
              )}
            </button>
          </div>
        );
      })}

      {/* Assistant History */}
      {isOpen && pathname.startsWith("/assistant") && (
        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <button
            onClick={() => setHistoryCollapsed((v) => !v)}
            className={`mb-2 flex items-center justify-between px-5 text-xs font-semibold text-gray-500 transition-colors hover:text-gray-700 ${
              shouldAnimate ? "sidebar-fade-in" : ""
            }`}
          >
            <span>Assistant History</span>
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${historyCollapsed ? "-rotate-90" : ""}`}
            />
          </button>
          <div className={`flex-1 overflow-y-auto ${historyCollapsed ? "hidden" : ""}`}>
            {!chats ? (
              <div className="space-y-1 px-2.5">
                {[40, 60, 50, 70, 45].map((w, i) => (
                  <div key={i} className="flex h-9 items-center rounded-md px-3">
                    <div
                      className="h-3 animate-pulse rounded bg-gray-200"
                      style={{ width: `${w}%` }}
                    />
                  </div>
                ))}
              </div>
            ) : chats.length === 0 ? (
              <div
                className={`px-5 py-2 text-xs text-gray-500 ${
                  shouldAnimate ? "sidebar-fade-in-2" : ""
                }`}
              >
                No chats yet
              </div>
            ) : (
              <div className={`space-y-1 px-2.5 ${shouldAnimate ? "sidebar-fade-in-2" : ""}`}>
                {chats.map((chat) => (
                  <SidebarChatItem
                    key={chat.id}
                    chat={chat}
                    isActive={currentChatId === chat.id}
                    applicationName={
                      chat.application_id ? applicationNames[chat.application_id] : undefined
                    }
                    onDeletedActive={() => {
                      const destination = chat.application_id
                        ? `/applications/${chat.application_id}?tab=assistant`
                        : "/assistant";
                      const span = getTracer().startSpan(
                        "chat.delete.navigate_after_active_delete",
                        {
                          attributes: {
                            "chat.id": chat.id,
                            "chat.application_id": chat.application_id ?? "",
                            "nav.from": pathname,
                            "nav.href": destination,
                            "nav.reason": "active_chat_deleted",
                          },
                        },
                      );
                      span.end();
                      router.push(destination);
                    }}
                    onSelect={() => {
                      setCurrentChatId(chat.id);
                      router.push(
                        chat.application_id
                          ? `/applications/${chat.application_id}/assistant/chat/${chat.id}`
                          : `/assistant/chat/${chat.id}`,
                      );
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* User Profile */}
      <div className="mt-auto">
        {user && (
          <div className="relative">
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className={`flex w-full items-center border-t border-gray-200 px-3.5 py-4 transition-colors ${
                !isOpen ? "hidden md:flex" : ""
              } ${pathname === "/account" || isDropdownOpen ? "bg-gray-100" : "hover:bg-gray-100"}`}
              title={!isOpen ? user.email : undefined}
            >
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-700 font-serif text-sm font-medium text-white">
                {getUserInitials(user.email)}
              </div>
              {isOpen && (
                <div
                  className={`flex min-w-0 flex-1 items-center justify-between gap-2 pl-3 text-left ${
                    shouldAnimate ? "sidebar-fade-in-2" : ""
                  }`}
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="text-sm leading-none font-medium text-gray-900">
                      {getDisplayName()}
                    </div>
                    <div className="text-[12px] leading-none text-gray-500">{getUserTier()}</div>
                  </div>
                  <ChevronsUpDown className="h-4 w-4 flex-shrink-0 text-gray-400" />
                </div>
              )}
            </button>

            {isDropdownOpen && (
              <div className="absolute bottom-full left-0 z-50 m-1 w-62 rounded-lg border border-gray-200 bg-white p-1 whitespace-nowrap shadow-lg">
                <button
                  onClick={() => {
                    const span = getTracer().startSpan("nav.click", {
                      attributes: {
                        "nav.href": "/account",
                        "nav.label": "Account",
                        "nav.from": pathname,
                      },
                    });
                    span.end();
                    router.push("/account");
                    setIsDropdownOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                >
                  <User className="h-4 w-4" />
                  Account Settings
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
