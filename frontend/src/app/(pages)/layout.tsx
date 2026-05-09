"use client";

import { Menu } from "lucide-react";
import { useEffect,useState } from "react";

import { AppSidebar } from "@/app/components/shared/AppSidebar";
import { ChatHistoryProvider } from "@/app/contexts/ChatHistoryContext";
import { SidebarContext } from "@/app/contexts/SidebarContext";
import { useAuth } from "@/contexts/AuthContext";

export default function LukeLayout({ children }: { children: React.ReactNode }) {
  const { authLoading } = useAuth();

  const [isSidebarOpenDesktop, setIsSidebarOpenDesktop] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sidebarOpen");
      return saved !== null ? saved === "true" : true;
    }
    return true;
  });

  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      return false;
    }
    return true;
  });

  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth >= 768) {
      localStorage.setItem("sidebarOpen", isSidebarOpen.toString());
    }
  }, [isSidebarOpenDesktop]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      const isSmall = window.innerWidth < 768;
      if (isSmall && isSidebarOpen) setIsSidebarOpen(false);
      else if (!isSmall && !isSidebarOpen) setIsSidebarOpen(isSidebarOpenDesktop);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isSidebarOpen, isSidebarOpenDesktop]);

  const handleSidebarToggle = () => {
    if (window.innerWidth >= 768) {
      setIsSidebarOpenDesktop(!isSidebarOpenDesktop);
      setIsSidebarOpen(!isSidebarOpenDesktop);
    } else {
      setIsSidebarOpen(!isSidebarOpen);
    }
  };

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700" />
      </div>
    );
  }

  return (
    <ChatHistoryProvider>
      <SidebarContext.Provider
        value={{
          setSidebarOpen: (open) => {
            setIsSidebarOpen(open);
            setIsSidebarOpenDesktop(open);
          },
        }}
      >
        <div className="flex h-dvh flex-col bg-white">
          <div className="flex flex-1 overflow-hidden">
            <AppSidebar isOpen={isSidebarOpen} onToggle={handleSidebarToggle} />
            <div className="relative flex h-dvh w-full flex-1 flex-col md:overflow-hidden">
              {/* Mobile header */}
              <div className="flex shrink-0 items-center gap-3 border-b border-gray-100 px-4 py-3 md:hidden">
                <button
                  onClick={handleSidebarToggle}
                  className="flex h-8 w-8 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-100"
                >
                  <Menu className="h-5 w-5" />
                </button>
              </div>
              <main className="h-full w-full flex-1 overflow-y-auto md:overflow-hidden">
                {children}
              </main>
            </div>
          </div>
        </div>
      </SidebarContext.Provider>
    </ChatHistoryProvider>
  );
}
