"use client";

import { Loader2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/contexts/AuthContext";

interface TabDef {
  id: string;
  label: string;
  href: string;
}

const TABS: TabDef[] = [
  { id: "general", label: "General", href: "/account" },
  { id: "models", label: "Models & API Keys", href: "/account/models" },
];

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col px-6 py-6 md:overflow-y-auto md:py-10">
      <div className="mx-auto w-full max-w-5xl">
        <h1 className="font-eb-garamond mb-8 text-4xl font-medium">Settings</h1>

        <div className="flex flex-col gap-6 md:flex-row md:gap-10">
          <nav
            aria-label="Settings"
            className="flex shrink-0 gap-1 overflow-x-auto md:w-56 md:flex-col"
          >
            {TABS.map((tab) => {
              const active = pathname === tab.href;
              return (
                <button
                  key={tab.id}
                  onClick={() => router.push(tab.href)}
                  className={`rounded-md px-3 py-2 text-left text-sm font-medium whitespace-nowrap transition-colors ${
                    active
                      ? "bg-gray-100 text-gray-900"
                      : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </div>
  );
}
