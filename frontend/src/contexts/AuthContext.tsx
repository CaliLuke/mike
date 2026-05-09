"use client";

import React, { createContext, type ReactNode,useContext, useEffect, useState } from "react";

import { apiRequest } from "@/app/lib/lukeApi";

interface User {
  id: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LOCAL_USER: User = {
  id: "local",
  email: "local@luke.local",
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(LOCAL_USER);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiRequest("/user/profile")
      .catch((e) => {
        console.log(e);
      })
      .finally(() => {
        if (cancelled) return;
        setUser(LOCAL_USER);
        setAuthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = async () => {
    setUser(LOCAL_USER);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: true,
        authLoading,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
