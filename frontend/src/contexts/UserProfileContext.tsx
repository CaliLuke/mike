"use client";

import React, {
    createContext,
    useContext,
    useEffect,
    useState,
    ReactNode,
    useCallback,
} from "react";
import { apiRequest } from "@/app/lib/mikeApi";
import { useAuth } from "@/contexts/AuthContext";

interface UserProfile {
    displayName: string | null;
    organisation: string | null;
    messageCreditsUsed: number;
    creditsResetDate: string;
    creditsRemaining: number;
    tier: string;
    tabularModel: string;
    claudeApiKey: string | null;
    geminiApiKey: string | null;
}

interface BackendProfile {
    id: string;
    email: string;
    display_name?: string | null;
    tier?: string | null;
    credits?: number | null;
    credits_reset_at?: string | null;
    settings?: {
        organisation?: string | null;
        tabular_model?: string | null;
        claude_api_key?: string | null;
        gemini_api_key?: string | null;
    };
}

interface UserProfileContextType {
    profile: UserProfile | null;
    loading: boolean;
    updateDisplayName: (name: string) => Promise<boolean>;
    updateOrganisation: (organisation: string) => Promise<boolean>;
    updateModelPreference: (
        field: "tabularModel",
        value: string,
    ) => Promise<boolean>;
    updateApiKey: (
        provider: "claude" | "gemini",
        value: string | null,
    ) => Promise<boolean>;
    reloadProfile: () => Promise<void>;
    incrementMessageCredits: () => Promise<boolean>;
}

const UserProfileContext = createContext<UserProfileContextType | undefined>(
    undefined,
);

const MONTHLY_CREDIT_LIMIT = 999999;
const DEFAULT_RESET_DATE = "9999-12-31T23:59:59Z";

function mapProfile(data: BackendProfile): UserProfile {
    const creditsUsed = data.credits ?? 0;
    return {
        displayName: data.display_name ?? null,
        organisation: data.settings?.organisation ?? null,
        messageCreditsUsed: creditsUsed,
        creditsResetDate: data.credits_reset_at ?? DEFAULT_RESET_DATE,
        creditsRemaining: MONTHLY_CREDIT_LIMIT - creditsUsed,
        tier: data.tier ?? "Local",
        tabularModel: data.settings?.tabular_model ?? "gemma4",
        claudeApiKey: data.settings?.claude_api_key ?? null,
        geminiApiKey: data.settings?.gemini_api_key ?? null,
    };
}

async function saveProfilePatch(
    patch: Record<string, string>,
): Promise<UserProfile> {
    const updated = await apiRequest<BackendProfile>("/user/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
    });
    return mapProfile(updated);
}

export function UserProfileProvider({ children }: { children: ReactNode }) {
    const { user, isAuthenticated } = useAuth();
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    const loadProfile = useCallback(async () => {
        try {
            const data = await apiRequest<BackendProfile>("/user/profile");
            setProfile(mapProfile(data));
        } catch {
            setProfile({
                displayName: "Local User",
                organisation: null,
                messageCreditsUsed: 0,
                creditsResetDate: DEFAULT_RESET_DATE,
                creditsRemaining: MONTHLY_CREDIT_LIMIT,
                tier: "Local",
                tabularModel: "gemma4",
                claudeApiKey: null,
                geminiApiKey: null,
            });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isAuthenticated && user) {
            setLoading(true);
            loadProfile();
        } else {
            setProfile(null);
            setLoading(false);
        }
    }, [isAuthenticated, user, loadProfile]);

    const updateDisplayName = useCallback(
        async (displayName: string): Promise<boolean> => {
            try {
                const next = await saveProfilePatch({
                    display_name: displayName,
                });
                setProfile(next);
                return true;
            } catch {
                return false;
            }
        },
        [],
    );

    const updateOrganisation = useCallback(
        async (organisation: string): Promise<boolean> => {
            try {
                const next = await saveProfilePatch({ organisation });
                setProfile(next);
                return true;
            } catch {
                return false;
            }
        },
        [],
    );

    const updateModelPreference = useCallback(
        async (
            field: "tabularModel",
            value: string,
        ): Promise<boolean> => {
            if (field !== "tabularModel") return false;
            try {
                const next = await saveProfilePatch({ tabular_model: value });
                setProfile(next);
                return true;
            } catch {
                return false;
            }
        },
        [],
    );

    const updateApiKey = useCallback(
        async (
            provider: "claude" | "gemini",
            value: string | null,
        ): Promise<boolean> => {
            const dbField =
                provider === "claude" ? "claude_api_key" : "gemini_api_key";
            const normalized = value?.trim() ?? "";
            try {
                const next = await saveProfilePatch({ [dbField]: normalized });
                setProfile(next);
                return true;
            } catch {
                return false;
            }
        },
        [],
    );

    const reloadProfile = useCallback(async () => {
        await loadProfile();
    }, [loadProfile]);

    const incrementMessageCredits = useCallback(async (): Promise<boolean> => {
        setProfile((prev) =>
            prev
                ? {
                      ...prev,
                      messageCreditsUsed: prev.messageCreditsUsed + 1,
                      creditsRemaining:
                          MONTHLY_CREDIT_LIMIT -
                          (prev.messageCreditsUsed + 1),
                  }
                : prev,
        );
        return true;
    }, []);

    return (
        <UserProfileContext.Provider
            value={{
                profile,
                loading,
                updateDisplayName,
                updateOrganisation,
                updateModelPreference,
                updateApiKey,
                reloadProfile,
                incrementMessageCredits,
            }}
        >
            {children}
        </UserProfileContext.Provider>
    );
}

export function useUserProfile() {
    const context = useContext(UserProfileContext);
    if (context === undefined) {
        throw new Error(
            "useUserProfile must be used within a UserProfileProvider",
        );
    }
    return context;
}
