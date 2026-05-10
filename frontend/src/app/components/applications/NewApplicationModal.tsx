"use client";

import { Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { DOCUMENT_UPLOAD_ACCEPT } from "@/app/lib/documentTypes";
import {
  addDocumentToApplication,
  createApplication,
  createCompany,
  listCompanies,
  uploadApplicationDocument,
} from "@/app/lib/lukeApi";

import { FileDirectory } from "../shared/FileDirectory";
import type { LukeApplication, LukeCompany } from "../shared/types";
import { useDirectoryData } from "../shared/useDirectoryData";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (application: LukeApplication) => void;
}

export function NewApplicationModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [companies, setCompanies] = useState<LukeCompany[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [newCompanyName, setNewCompanyName] = useState("");
  const [cmNumber, setCmNumber] = useState("");
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    loading: dirLoading,
    standaloneDocuments,
    applications: dirApplications,
  } = useDirectoryData(open);

  useEffect(() => {
    if (!open) return;
    listCompanies()
      .then((items) => {
        setCompanies(items);
        setCompanyId((current) => current || items[0]?.id || "");
      })
      .catch(() => setCompanies([]));
  }, [open]);

  if (!open) return null;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setPendingFiles((prev) => [
      ...prev,
      ...files.filter((f) => !prev.some((p) => p.name === f.name)),
    ]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || (!companyId && !newCompanyName.trim())) return;
    setLoading(true);
    setError("");
    try {
      const company = companyId || (await createCompany(newCompanyName.trim())).id;
      const application = await createApplication(
        name.trim(),
        company,
        cmNumber.trim() || undefined,
      );
      await Promise.all([
        ...[...selectedDocIds].map((id) =>
          addDocumentToApplication(application.id, id).catch(() => {}),
        ),
        ...pendingFiles.map((f) => uploadApplicationDocument(application.id, f).catch(() => {})),
      ]);
      onCreated({ ...application, document_count: selectedDocIds.size + pendingFiles.length });
      resetForm();
      onClose();
    } catch (err: unknown) {
      setError((err as Error).message || "Failed to create application");
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setName("");
    setCompanyId("");
    setNewCompanyName("");
    setCmNumber("");
    setSelectedDocIds(new Set());
    setPendingFiles([]);
    setError("");
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-101 flex items-center justify-center bg-black/20 backdrop-blur-xs">
      <div className="flex h-[600px] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span>Applications</span>
            <span>›</span>
            <span>New application</span>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-6 pt-3 pb-5">
            {/* Title */}
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Application name"
              className="w-full bg-transparent font-serif text-2xl text-gray-800 placeholder-gray-300 focus:outline-none"
              autoFocus
            />

            <div className="mt-3 grid grid-cols-2 gap-3">
              <select
                value={companyId}
                onChange={(e) => {
                  setCompanyId(e.target.value);
                  setNewCompanyName("");
                }}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none"
              >
                <option value="">New company</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
              {!companyId && (
                <input
                  type="text"
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  placeholder="Company name"
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none placeholder:text-gray-300"
                />
              )}
            </div>

            {/* CM Number */}
            <input
              type="text"
              value={cmNumber}
              onChange={(e) => setCmNumber(e.target.value)}
              placeholder="Add a CM number..."
              className="mt-1.5 w-full bg-transparent text-sm text-gray-500 placeholder-gray-300 focus:outline-none"
            />

            {/* Documents */}
            <div className="mt-4 space-y-2">
              <p className="text-xs font-medium text-gray-700">Select documents</p>
              <FileDirectory
                standaloneDocs={standaloneDocuments}
                directoryApplications={dirApplications}
                loading={dirLoading}
                selectedIds={selectedDocIds}
                onChange={setSelectedDocIds}
                emptyMessage="No existing documents"
              />
            </div>

            {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-between border-t border-gray-100 px-6 py-4">
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={DOCUMENT_UPLOAD_ACCEPT}
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-50"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload files{pendingFiles.length > 0 ? ` (${pendingFiles.length})` : ""}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg px-4 py-2 text-sm text-gray-500 transition-colors hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name.trim() || (!companyId && !newCompanyName.trim()) || loading}
                className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-40"
              >
                {loading ? "Creating…" : "Create application"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
