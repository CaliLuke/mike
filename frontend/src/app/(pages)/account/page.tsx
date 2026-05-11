"use client";

import { Check, LogOut, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { deleteAccount, resetUserContent, wipeTelemetry } from "@/app/lib/lukeApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/contexts/UserProfileContext";

export default function AccountPage() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { profile, updateDisplayName, updateOrganisation } = useUserProfile();
  const [displayName, setDisplayName] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);
  const [saved, setSaved] = useState(false);
  const [organisation, setOrganisation] = useState("");
  const [isSavingOrg, setIsSavingOrg] = useState(false);
  const [orgSaved, setOrgSaved] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isWipingTelemetry, setIsWipingTelemetry] = useState(false);
  const [telemetryWiped, setTelemetryWiped] = useState(false);
  const [resetContentConfirm, setResetContentConfirm] = useState(false);
  const [isResettingContent, setIsResettingContent] = useState(false);
  const [contentReset, setContentReset] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      if (profile?.displayName) {
        setDisplayName(profile.displayName);
      }
      if (profile?.organisation) {
        setOrganisation(profile.organisation);
      }
    });
  }, [profile]);

  const handleLogout = async () => {
    await signOut();
    router.push("/");
  };

  const handleDeleteAccount = async () => {
    setErrorMessage(null);
    setIsDeleting(true);
    try {
      await deleteAccount();
      await signOut();
      router.push("/");
    } catch {
      setIsDeleting(false);
      setDeleteConfirm(false);
      setErrorMessage("Failed to delete account. Please try again.");
    }
  };

  const handleSaveDisplayName = async () => {
    setErrorMessage(null);
    setIsSavingName(true);
    const success = await updateDisplayName(displayName.trim());
    setIsSavingName(false);

    if (success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else {
      setErrorMessage("Failed to update display name. Please try again.");
    }
  };

  const handleResetUserContent = async () => {
    setErrorMessage(null);
    setIsResettingContent(true);
    try {
      await resetUserContent();
      setResetContentConfirm(false);
      setContentReset(true);
      setTimeout(() => setContentReset(false), 2000);
    } catch {
      setErrorMessage("Failed to reset content. Please try again.");
    } finally {
      setIsResettingContent(false);
    }
  };

  const handleWipeTelemetry = async () => {
    setErrorMessage(null);
    setIsWipingTelemetry(true);
    try {
      await wipeTelemetry();
      setTelemetryWiped(true);
      setTimeout(() => setTelemetryWiped(false), 2000);
    } catch {
      setErrorMessage("Failed to wipe debug logs. Please try again.");
    } finally {
      setIsWipingTelemetry(false);
    }
  };

  const handleSaveOrganisation = async () => {
    setErrorMessage(null);
    setIsSavingOrg(true);
    const success = await updateOrganisation(organisation.trim());
    setIsSavingOrg(false);

    if (success) {
      setOrgSaved(true);
      setTimeout(() => setOrgSaved(false), 2000);
    } else {
      setErrorMessage("Failed to update organisation. Please try again.");
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-4">
      {errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      )}
      {/* Profile Settings */}
      <div className="pb-6">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="font-serif text-2xl font-medium">Profile</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-gray-600">Display Name</label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter your name"
                className="flex-1"
              />
              <Button
                onClick={handleSaveDisplayName}
                disabled={isSavingName || !displayName.trim() || saved}
                className="min-w-[80px] bg-black text-white transition-all hover:bg-gray-900"
              >
                {isSavingName ? (
                  "Saving..."
                ) : saved ? (
                  <>
                    <Check className="h-4 w-3" />
                    Saved
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm text-gray-600">Organisation</label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={organisation}
                onChange={(e) => setOrganisation(e.target.value)}
                placeholder="Enter your organisation"
                className="flex-1"
              />
              <Button
                onClick={handleSaveOrganisation}
                disabled={
                  isSavingOrg || organisation.trim() === (profile?.organisation ?? "") || orgSaved
                }
                className="min-w-[80px] bg-black text-white transition-all hover:bg-gray-900"
              >
                {isSavingOrg ? (
                  "Saving..."
                ) : orgSaved ? (
                  <>
                    <Check className="h-4 w-3" />
                    Saved
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm text-gray-600">Email</label>
            <p className="text-base">{user?.email}</p>
          </div>
        </div>
      </div>

      {/* Plan */}
      <div className="py-6">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="font-serif text-2xl font-medium">Usage Plan</h2>
        </div>
        <div>
          <p className="text-base font-medium text-gray-500 capitalize">
            {profile?.tier || "Free"}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="py-6">
        <h2 className="mb-4 font-serif text-2xl font-medium">Actions</h2>
        <Button variant="outline" onClick={handleLogout} className="w-full sm:w-auto">
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </Button>
      </div>

      {/* Diagnostics */}
      <div className="py-6">
        <h2 className="mb-1 font-serif text-2xl font-medium">Diagnostics</h2>
        <p className="mb-4 text-sm text-gray-500">
          Tools for reproducing issues from a clean state.
        </p>

        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm text-gray-600">
              Wipe the local telemetry database (spans, traces).
            </p>
            <Button
              variant="outline"
              onClick={handleWipeTelemetry}
              disabled={isWipingTelemetry || telemetryWiped}
              className="w-full sm:w-auto"
            >
              {telemetryWiped ? (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Wiped
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  {isWipingTelemetry ? "Wiping…" : "Wipe Debug Logs"}
                </>
              )}
            </Button>
          </div>

          <div>
            <p className="mb-2 text-sm text-gray-600">
              Delete all companies, applications, documents, and chats. Blob storage is also
              cleared. Your account stays signed in.
            </p>
            {resetContentConfirm ? (
              <div className="max-w-sm space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-medium text-amber-800">
                  This permanently deletes all your companies, applications, documents, and chats.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setResetContentConfirm(false)}
                    disabled={isResettingContent}
                    className="text-sm"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleResetUserContent}
                    disabled={isResettingContent}
                    className="bg-amber-600 text-sm text-white hover:bg-amber-700"
                  >
                    {isResettingContent ? "Resetting…" : "Delete Everything"}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={() => setResetContentConfirm(true)}
                disabled={contentReset}
                className="w-full sm:w-auto"
              >
                {contentReset ? (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Reset
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Reset All Content
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="py-6">
        <h2 className="mb-1 font-serif text-2xl font-medium text-red-600">Danger Zone</h2>
        <p className="mb-4 text-sm text-gray-500">
          Permanently delete your account and all associated data. This action cannot be undone.
        </p>
        {deleteConfirm ? (
          <div className="max-w-sm space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-700">
              Are you sure? This will permanently delete your account.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setDeleteConfirm(false)}
                disabled={isDeleting}
                className="text-sm"
              >
                Cancel
              </Button>
              <Button
                onClick={handleDeleteAccount}
                disabled={isDeleting}
                className="bg-red-600 text-sm text-white hover:bg-red-700"
              >
                {isDeleting ? "Deleting…" : "Delete Account"}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            onClick={() => setDeleteConfirm(true)}
            className="w-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 sm:w-auto"
          >
            Delete Account
          </Button>
        )}
      </div>
    </div>
  );
}
