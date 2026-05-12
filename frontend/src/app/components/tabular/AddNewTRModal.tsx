"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { Check, ChevronDown, Loader2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { DOCUMENT_UPLOAD_ACCEPT } from "@/app/lib/documentTypes";
import {
  createApplication,
  createCompany,
  getApplication,
  listApplications,
  listCompanies,
  listStandaloneDocuments,
  listWorkflows,
  uploadApplicationDocument,
  uploadStandaloneDocument,
} from "@/app/lib/lukeApi";
import { trackClick } from "@/app/lib/telemetry";

import { FileDirectory } from "../shared/FileDirectory";
import type { LukeApplication, LukeCompany, LukeDocument, LukeWorkflow } from "../shared/types";
import { useInvalidateDirectory } from "../shared/useDirectoryData";
import { BUILT_IN_WORKFLOWS } from "../workflows/builtinWorkflows";

interface Props {
  open: boolean;
  onClose: () => void;
  onAdd: (
    title: string,
    applicationId?: string,
    documentIds?: string[],
    columnsConfig?: LukeWorkflow["columns_config"],
    createdApplication?: LukeApplication,
  ) => void | Promise<void>;
  applications?: LukeApplication[];
  /** When provided, skip the application/directory picker and show only these docs */
  applicationDocs?: LukeDocument[];
  applicationName?: string;
}

export function AddNewTRModal({
  open,
  onClose,
  onAdd,
  applications = [],
  applicationDocs: fixedApplicationDocs,
  applicationName,
}: Props) {
  const invalidateDirectory = useInvalidateDirectory();
  const isApplicationMode = fixedApplicationDocs !== undefined;
  const [title, setTitle] = useState("");
  const [underApplication, setUnderApplication] = useState(false);
  const [selectedApplicationId, setSelectedApplicationId] = useState("");
  const [creatingApplicationInline, setCreatingApplicationInline] = useState(false);
  const [newApplicationName, setNewApplicationName] = useState("");
  const [companies, setCompanies] = useState<LukeCompany[]>([]);
  const [newApplicationCompanyId, setNewApplicationCompanyId] = useState("");
  const [newApplicationCompanyName, setNewApplicationCompanyName] = useState("");
  const [applicationDropdownOpen, setApplicationDropdownOpen] = useState(false);

  // Application-scoped docs (when underApplication is true and no fixedApplicationDocs)
  const [applicationDocs, setApplicationDocs] = useState<LukeDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);

  // Full directory (when underApplication is false)
  const [standaloneDocs, setStandaloneDocs] = useState<LukeDocument[]>([]);
  const [directoryApplications, setDirectoryApplications] = useState<LukeApplication[]>([]);
  const [loadingDirectory, setLoadingDirectory] = useState(false);

  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Workflow templates
  const [workflows, setWorkflows] = useState<LukeWorkflow[]>([]);
  const [loadingWorkflows, setLoadingWorkflows] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [workflowDropdownOpen, setWorkflowDropdownOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    setLoadingWorkflows(true);
    const builtinTabular = BUILT_IN_WORKFLOWS.filter((w) => w.type === "tabular");
    listWorkflows("tabular")
      .then((custom) => setWorkflows([...builtinTabular, ...custom]))
      .catch(() => setWorkflows(builtinTabular))
      .finally(() => setLoadingWorkflows(false));

    if (isApplicationMode) {
      setSelectedDocIds(new Set((fixedApplicationDocs ?? []).map((d) => d.id)));
      return;
    }

    setLoadingDirectory(true);
    // /applications only returns counts, not the documents array — fetch
    // each application in parallel so FileDirectory can render the docs
    // when the user expands a folder.
    Promise.all([listStandaloneDocuments(), listApplications(), listCompanies()])
      .then(async ([docs, projs, companyRows]) => {
        setStandaloneDocs(
          [...docs].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")),
        );
        setCompanies(companyRows);
        setNewApplicationCompanyId((current) => current || companyRows[0]?.id || "");
        const fullApplications = await Promise.all(projs.map((p) => getApplication(p.id)));
        setDirectoryApplications(fullApplications);
      })
      .catch(() => {
        setStandaloneDocs([]);
        setDirectoryApplications([]);
      })
      .finally(() => setLoadingDirectory(false));
  }, [fixedApplicationDocs, isApplicationMode, open]);

  if (!open) return null;

  function handleClose() {
    setTitle("");
    setUnderApplication(false);
    setSelectedApplicationId("");
    setCreatingApplicationInline(false);
    setNewApplicationName("");
    setNewApplicationCompanyId("");
    setNewApplicationCompanyName("");
    setApplicationDropdownOpen(false);
    setApplicationDocs([]);
    setStandaloneDocs([]);
    setDirectoryApplications([]);
    setSelectedDocIds(new Set());
    setSelectedWorkflowId(null);
    setWorkflowDropdownOpen(false);
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    if (underApplication && !selectedApplicationId && !newApplicationName.trim()) return;
    if (
      underApplication &&
      !selectedApplicationId &&
      !newApplicationCompanyId &&
      !newApplicationCompanyName.trim()
    )
      return;
    const selectedWorkflow = workflows.find((w) => w.id === selectedWorkflowId);
    setSubmitting(true);
    try {
      const createdApplication =
        underApplication && !selectedApplicationId
          ? await createApplication({
              name: newApplicationName.trim(),
              company_id:
                newApplicationCompanyId ||
                (await createCompany(newApplicationCompanyName.trim())).id,
            })
          : undefined;
      if (createdApplication) invalidateDirectory();
      const applicationId = createdApplication?.id ?? selectedApplicationId;
      trackClick("tabular_review.create", {
        "workflow.id": selectedWorkflow?.id ?? null,
        "workflow.title": selectedWorkflow?.title ?? null,
        "doc.count": selectedDocIds.size,
        "application.id": applicationId ?? null,
        "application.created": !!createdApplication,
      });
      await onAdd(
        title.trim(),
        underApplication ? applicationId : undefined,
        selectedDocIds.size > 0 ? [...selectedDocIds] : undefined,
        selectedWorkflow?.columns_config ?? undefined,
        createdApplication,
      );
      handleClose();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSelectApplication(applicationId: string) {
    setSelectedApplicationId(applicationId);
    setCreatingApplicationInline(false);
    setNewApplicationName("");
    setNewApplicationCompanyName("");
    setApplicationDropdownOpen(false);
    setApplicationDocs([]);
    setSelectedDocIds(new Set());
    setLoadingDocs(true);
    try {
      const proj = await getApplication(applicationId);
      const docs = (proj.documents ?? []).filter((d) => d.status === "ready");
      setApplicationDocs(docs);
      setSelectedDocIds(new Set(docs.map((d) => d.id)));
    } finally {
      setLoadingDocs(false);
    }
  }

  function handleSelectNewApplication() {
    setCreatingApplicationInline(true);
    setSelectedApplicationId("");
    setNewApplicationCompanyId((current) => current || companies[0]?.id || "");
    setApplicationDropdownOpen(false);
    setApplicationDocs([]);
    setSelectedDocIds(new Set());
    setLoadingDocs(false);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(
        files.map((f) =>
          underApplication && selectedApplicationId
            ? uploadApplicationDocument(selectedApplicationId, f)
            : uploadStandaloneDocument(f),
        ),
      );
      if (underApplication && selectedApplicationId) {
        setApplicationDocs((prev) => [...uploaded, ...prev]);
      } else {
        setStandaloneDocs((prev) => [...uploaded, ...prev]);
      }
      uploaded.forEach((d) => setSelectedDocIds((prev) => new Set([...prev, d.id])));
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const selectedApplication = applications.find((p) => p.id === selectedApplicationId);
  const selectedWorkflow = workflows.find((w) => w.id === selectedWorkflowId);
  const trimmedNewApplicationName = newApplicationName.trim();

  // What to show in the directory depends on mode and toggle state
  const directoryStandalone = isApplicationMode
    ? (fixedApplicationDocs ?? [])
    : underApplication
      ? []
      : standaloneDocs;
  const directoryFolders = isApplicationMode ? [] : underApplication ? [] : directoryApplications;
  const flatApplicationDocs: LukeDocument[] =
    !isApplicationMode && underApplication ? applicationDocs : [];
  const directoryLoading = isApplicationMode
    ? false
    : underApplication
      ? loadingDocs
      : loadingDirectory;
  const showDirectory =
    isApplicationMode || !underApplication || !!selectedApplicationId || creatingApplicationInline;

  return createPortal(
    <div className="fixed inset-0 z-[101] flex items-center justify-center bg-black/20 backdrop-blur-xs">
      <div className="flex h-[600px] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-6 pt-5 pb-2">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            {isApplicationMode && applicationName ? (
              <>
                <span>Applications</span>
                <span>›</span>
                <span>{applicationName}</span>
                <span>›</span>
                <span>Tabular Reviews</span>
                <span>›</span>
                <span>New review</span>
              </>
            ) : (
              <>
                <span>Tabular Reviews</span>
                <span>›</span>
                <span>New review</span>
              </>
            )}
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-6 pt-3 pb-4">
            {/* Title */}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Review name"
              className="w-full bg-transparent font-serif text-2xl text-gray-800 placeholder-gray-400 focus:outline-none"
              autoFocus
            />

            {/* Workflow template */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-700">Workflow Template</p>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setWorkflowDropdownOpen((o) => !o)}
                  disabled={loadingWorkflows}
                  className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm transition-colors hover:border-gray-400 focus:outline-none"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {loadingWorkflows && (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-gray-400" />
                    )}
                    <span className={selectedWorkflow ? "truncate text-gray-800" : "text-gray-400"}>
                      {loadingWorkflows
                        ? "Loading templates…"
                        : selectedWorkflow
                          ? selectedWorkflow.title
                          : "No template — start from scratch"}
                    </span>
                  </div>
                  <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 text-gray-400" />
                </button>
                {workflowDropdownOpen && !loadingWorkflows && (
                  <div className="absolute top-full left-0 z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-gray-100 bg-white shadow-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedWorkflowId(null);
                        setWorkflowDropdownOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50 ${!selectedWorkflowId ? "bg-gray-50 text-gray-900" : "text-gray-500"}`}
                    >
                      <span className="flex-1">No template — start from scratch</span>
                      {!selectedWorkflowId && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                      )}
                    </button>
                    {workflows.length > 0 && <div className="border-t border-gray-100" />}
                    {workflows.map((wf) => (
                      <button
                        key={wf.id}
                        type="button"
                        onClick={() => {
                          setSelectedWorkflowId(wf.id);
                          setWorkflowDropdownOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50 ${selectedWorkflowId === wf.id ? "bg-gray-50 text-gray-900" : "text-gray-700"}`}
                      >
                        <span className="flex-1 truncate">{wf.title}</span>
                        {selectedWorkflowId === wf.id && (
                          <Check className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Create under a application toggle */}
            {!isApplicationMode && (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => {
                    const next = !underApplication;
                    setUnderApplication(next);
                    if (!next) {
                      setSelectedApplicationId("");
                      setCreatingApplicationInline(false);
                      setNewApplicationName("");
                      setApplicationDropdownOpen(false);
                      setApplicationDocs([]);
                      setSelectedDocIds(new Set());
                    }
                  }}
                  className="flex w-fit items-center gap-2.5"
                >
                  <span
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${underApplication ? "bg-gray-900" : "bg-gray-200"}`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${underApplication ? "translate-x-4" : "translate-x-0"}`}
                    />
                  </span>
                  <span className="text-sm text-gray-600">Create under a application</span>
                </button>

                {underApplication && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setApplicationDropdownOpen((o) => !o)}
                      className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm transition-colors hover:border-gray-400 focus:outline-none"
                    >
                      <span
                        className={
                          selectedApplication || creatingApplicationInline
                            ? "text-gray-800"
                            : "text-gray-400"
                        }
                      >
                        {creatingApplicationInline
                          ? trimmedNewApplicationName || "New application…"
                          : selectedApplication
                            ? selectedApplication.name
                            : "Select application…"}
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    </button>
                    {applicationDropdownOpen && (
                      <div className="absolute top-full left-0 z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-gray-100 bg-white shadow-lg">
                        <button
                          type="button"
                          onClick={handleSelectNewApplication}
                          className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50 ${creatingApplicationInline ? "bg-gray-50 text-gray-900" : "text-gray-700"}`}
                        >
                          <span className="truncate">New application</span>
                          {creatingApplicationInline && (
                            <Check className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                          )}
                        </button>
                        {applications.length > 0 && <div className="border-t border-gray-100" />}
                        {applications.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => handleSelectApplication(p.id)}
                            className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50 ${selectedApplicationId === p.id ? "bg-gray-50 text-gray-900" : "text-gray-700"}`}
                          >
                            <span className="truncate">{p.name}</span>
                            {selectedApplicationId === p.id && (
                              <Check className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {underApplication && creatingApplicationInline && (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={newApplicationName}
                      onChange={(e) => setNewApplicationName(e.target.value)}
                      placeholder="Application name"
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
                    />
                    <select
                      value={newApplicationCompanyId}
                      onChange={(e) => {
                        setNewApplicationCompanyId(e.target.value);
                        setNewApplicationCompanyName("");
                      }}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-gray-400 focus:outline-none"
                    >
                      <option value="">New company</option>
                      {companies.map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.name}
                        </option>
                      ))}
                    </select>
                    {!newApplicationCompanyId && (
                      <input
                        type="text"
                        value={newApplicationCompanyName}
                        onChange={(e) => setNewApplicationCompanyName(e.target.value)}
                        placeholder="Company name"
                        className="col-span-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* File directory */}
            {showDirectory && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-700">Select Documents</p>
                <div>
                  <FileDirectory
                    standaloneDocs={
                      isApplicationMode
                        ? directoryStandalone
                        : underApplication
                          ? flatApplicationDocs
                          : directoryStandalone
                    }
                    directoryApplications={
                      isApplicationMode ? [] : underApplication ? [] : directoryFolders
                    }
                    loading={directoryLoading}
                    selectedIds={selectedDocIds}
                    onChange={setSelectedDocIds}
                    heading={isApplicationMode ? "Application Documents" : "Documents"}
                    emptyMessage={
                      creatingApplicationInline
                        ? "Upload documents after creating the application"
                        : isApplicationMode || underApplication
                          ? "No ready documents in this application"
                          : "No documents yet"
                    }
                  />
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-gray-100 px-6 py-4">
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept={DOCUMENT_UPLOAD_ACCEPT}
                multiple
                className="hidden"
                onChange={handleUpload}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || (underApplication && !selectedApplicationId)}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                {uploading ? "Uploading…" : "Upload"}
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
                disabled={
                  !title.trim() ||
                  submitting ||
                  (underApplication && !selectedApplicationId && !trimmedNewApplicationName)
                }
                className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-40"
              >
                {submitting ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
