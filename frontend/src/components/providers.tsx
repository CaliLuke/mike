"use client";

import { QueryProvider } from "@/components/queryClient";
import { AuthProvider } from "@/contexts/AuthContext";
import { UserProfileProvider } from "@/contexts/UserProfileContext";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>
        <UserProfileProvider>{children}</UserProfileProvider>
      </AuthProvider>
    </QueryProvider>
  );
}
