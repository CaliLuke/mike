"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { KIND_LABELS } from "@/app/components/files/MetadataBadges";
import type {
  LukeApplication,
  LukeDocument,
  LukeDocumentKind,
  LukeDocumentMetadataPatch,
  LukeInterviewStage,
  LukeLibraryKind,
  LukePersonRef,
} from "@/app/components/shared/types";
import {
  addDocumentApplicationLink,
  deleteDocumentApplicationLink,
  patchDocumentMetadata,
  processDocumentMetadata,
} from "@/app/lib/documentMetadata";
import { listApplications } from "@/app/lib/lukeApi";

const LIBRARY_KINDS: { value: LukeLibraryKind; label: string }[] = [
  { value: "shared", label: "Shared (my material)" },
  { value: "reference", label: "Reference (external)" },
];

const INTERVIEW_STAGES: { value: LukeInterviewStage; label: string }[] = [
  { value: "recruiter", label: "Recruiter" },
  { value: "hiring_manager", label: "Hiring Manager" },
  { value: "peer", label: "Peer" },
  { value: "tech", label: "Tech" },
  { value: "panel", label: "Panel" },
  { value: "onsite", label: "Onsite" },
  { value: "other", label: "Other" },
];

interface MetadataPanelProps {
  doc: LukeDocument;
  onUpdated: (updated: LukeDocument) => void;
}

interface FormState {
  kind: LukeDocumentKind;
  library: boolean;
  libraryKind: LukeLibraryKind | "";
  interviewStage: LukeInterviewStage | "";
  summary: string;
  topicsText: string;
  companyRefsText: string;
  peopleRefs: LukePersonRef[];
  datedEventAt: string;
}

function buildFormState(doc: LukeDocument): FormState {
  return {
    kind: (doc.kind ?? "unclassified") as LukeDocumentKind,
    library: doc.library ?? false,
    libraryKind: (doc.library_kind ?? "") as LukeLibraryKind | "",
    interviewStage: (doc.interview_stage ?? "") as LukeInterviewStage | "",
    summary: doc.summary ?? "",
    topicsText: (doc.topics ?? []).join(", "),
    companyRefsText: (doc.company_refs ?? []).join(", "),
    peopleRefs: doc.people_refs ?? [],
    datedEventAt: doc.dated_event_at ?? "",
  };
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function trimApplicationRef(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.startsWith("applications:") ? value.slice("applications:".length) : value;
}

function trimDocumentRef(value: string): string {
  return value.startsWith("documents:") ? value.slice("documents:".length) : value;
}

// MetadataPanel renders the classifier output for a single document with
// inline editing, a "Confirm" button that flips metadata_status to
// user_confirmed, and (for library docs only) an application-link manager.
//
// The component is intentionally a single file — split it only if it grows
// past ~300 lines or shared concerns emerge between callers.
// MetadataPanel is keyed by `doc.id + doc.metadata_processed_at` at the
// callsite so the form remounts (and re-initialises from props) whenever
// the classifier or a save lands fresh content — which sidesteps the
// "setState inside effect to sync from prop" anti-pattern.
export function MetadataPanel({ doc, onUpdated }: MetadataPanelProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => buildFormState(doc));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);

  const status = doc.metadata_status ?? "unprocessed";

  async function handleSave(confirm: boolean) {
    setError(null);
    setSaving(true);
    try {
      const patch: LukeDocumentMetadataPatch = {
        confirm,
        kind: form.kind,
        library: form.library,
        library_kind: form.libraryKind || "",
        interview_stage: form.interviewStage || "",
        summary: form.summary,
        topics: splitCsv(form.topicsText),
        company_refs: splitCsv(form.companyRefsText),
        people_refs: form.peopleRefs,
        dated_event_at: form.datedEventAt,
      };
      const updated = await patchDocumentMetadata(trimDocumentRef(doc.id), patch);
      onUpdated(updated);
      // Refresh the queue pill in case our edit changed status.
      void queryClient.invalidateQueries({ queryKey: ["metadata-queue"] });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleClassify() {
    setError(null);
    setClassifying(true);
    try {
      await processDocumentMetadata(trimDocumentRef(doc.id));
      void queryClient.invalidateQueries({ queryKey: ["metadata-queue"] });
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
    } finally {
      setClassifying(false);
    }
  }

  function addPerson() {
    setForm({ ...form, peopleRefs: [...form.peopleRefs, { name: "", role: "" }] });
  }
  function updatePerson(index: number, patch: Partial<LukePersonRef>) {
    setForm({
      ...form,
      peopleRefs: form.peopleRefs.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    });
  }
  function removePerson(index: number) {
    setForm({
      ...form,
      peopleRefs: form.peopleRefs.filter((_, i) => i !== index),
    });
  }

  return (
    <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-800">Document metadata</h2>
        {status === "unprocessed" || status === "error" ? (
          <button
            type="button"
            disabled={classifying}
            onClick={handleClassify}
            className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60"
          >
            {classifying
              ? "Queueing…"
              : status === "error"
                ? "Retry classification"
                : "Classify this document"}
          </button>
        ) : null}
      </header>

      {doc.metadata_error && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          Last classifier error: {doc.metadata_error}
        </p>
      )}

      <FieldRow label="Kind">
        <select
          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm"
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value as LukeDocumentKind })}
        >
          {Object.entries(KIND_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </FieldRow>

      <FieldRow label="Scope">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={form.library}
              onChange={(e) =>
                setForm({
                  ...form,
                  library: e.target.checked,
                  // Reset library_kind when leaving library mode.
                  libraryKind: e.target.checked ? form.libraryKind || "shared" : "",
                })
              }
            />
            <span>Library document (reusable)</span>
          </label>
          {form.library && (
            <select
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm"
              value={form.libraryKind}
              onChange={(e) =>
                setForm({ ...form, libraryKind: e.target.value as LukeLibraryKind | "" })
              }
            >
              {LIBRARY_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </FieldRow>

      <FieldRow label="Interview stage">
        <select
          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm"
          value={form.interviewStage}
          onChange={(e) =>
            setForm({ ...form, interviewStage: e.target.value as LukeInterviewStage | "" })
          }
        >
          <option value="">— (not applicable) —</option>
          {INTERVIEW_STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </FieldRow>

      <FieldRow label="Summary">
        <textarea
          className="min-h-[64px] w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm"
          value={form.summary}
          onChange={(e) => setForm({ ...form, summary: e.target.value })}
          placeholder="2-4 sentences describing what the document is."
        />
      </FieldRow>

      <FieldRow label="Topics">
        <input
          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm"
          value={form.topicsText}
          onChange={(e) => setForm({ ...form, topicsText: e.target.value })}
          placeholder="comma, separated, tags"
        />
      </FieldRow>

      <FieldRow label="Companies mentioned">
        <input
          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm"
          value={form.companyRefsText}
          onChange={(e) => setForm({ ...form, companyRefsText: e.target.value })}
          placeholder="Google, Lever, LinkedIn"
        />
      </FieldRow>

      <FieldRow label="People referenced">
        <div className="space-y-2">
          {form.peopleRefs.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm"
                placeholder="Name"
                value={p.name}
                onChange={(e) => updatePerson(i, { name: e.target.value })}
              />
              <input
                className="flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm"
                placeholder="Role"
                value={p.role ?? ""}
                onChange={(e) => updatePerson(i, { role: e.target.value })}
              />
              <button
                type="button"
                onClick={() => removePerson(i)}
                className="text-xs text-zinc-500 hover:text-rose-600"
              >
                remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addPerson}
            className="text-xs text-zinc-600 underline-offset-2 hover:text-zinc-900 hover:underline"
          >
            + add person
          </button>
        </div>
      </FieldRow>

      <FieldRow label="Event date">
        <input
          type="text"
          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm"
          value={form.datedEventAt}
          onChange={(e) => setForm({ ...form, datedEventAt: e.target.value })}
          placeholder="2025-11-25T00:00:00Z (ISO 8601)"
        />
      </FieldRow>

      {error && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => handleSave(false)}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => handleSave(true)}
          className="rounded-md border border-sky-300 bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
        >
          {saving ? "Confirming…" : "Confirm"}
        </button>
      </div>

      {form.library ? <LibraryLinksEditor doc={doc} onUpdated={onUpdated} /> : null}
    </section>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</div>
      {children}
    </div>
  );
}

// LibraryLinksEditor manages document_application_links rows from the doc
// side: list current links, remove with DELETE, add via a select-box of all
// applications. Only rendered when library=true.
function LibraryLinksEditor({
  doc,
  onUpdated,
}: {
  doc: LukeDocument;
  onUpdated: (doc: LukeDocument) => void;
}) {
  const { data: applications = [] } = useQuery<LukeApplication[]>({
    queryKey: ["applications"],
    queryFn: listApplications,
  });
  const [addingId, setAddingId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linkedSet = useMemo(() => {
    return new Set((doc.linked_application_ids ?? []).map((ref) => trimApplicationRef(ref) ?? ref));
  }, [doc.linked_application_ids]);

  const candidates = applications
    .map((a) => ({ id: trimApplicationRef(a.id) ?? a.id, name: a.name }))
    .filter((a) => a.id && !linkedSet.has(a.id));

  async function addLink() {
    if (!addingId) return;
    setBusy(true);
    setError(null);
    try {
      await addDocumentApplicationLink(trimDocumentRef(doc.id), addingId);
      onUpdated({
        ...doc,
        linked_application_ids: [...(doc.linked_application_ids ?? []), `applications:${addingId}`],
      });
      setAddingId("");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function removeLink(appId: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteDocumentApplicationLink(trimDocumentRef(doc.id), appId);
      onUpdated({
        ...doc,
        linked_application_ids: (doc.linked_application_ids ?? []).filter(
          (ref) => (trimApplicationRef(ref) ?? ref) !== appId,
        ),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  const linkedApps = (doc.linked_application_ids ?? [])
    .map((ref) => trimApplicationRef(ref) ?? ref)
    .map((id) => ({
      id,
      name: applications.find((a) => trimApplicationRef(a.id) === id)?.name ?? id,
    }));

  return (
    <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
      <div className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
        Applications using this library document
      </div>
      {linkedApps.length === 0 ? (
        <p className="text-xs text-zinc-500">Not linked to any application yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {linkedApps.map((a) => (
            <li
              key={a.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-white px-2 py-0.5 text-xs text-violet-700"
            >
              <span>{a.name}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => removeLink(a.id)}
                className="text-violet-500 hover:text-rose-600 disabled:opacity-60"
                title="Remove link"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <select
          className="flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs"
          value={addingId}
          onChange={(e) => setAddingId(e.target.value)}
          disabled={candidates.length === 0 || busy}
        >
          <option value="">— select an application —</option>
          {candidates.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={addLink}
          disabled={!addingId || busy}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60"
        >
          Link
        </button>
      </div>
      {error && <p className="text-xs text-rose-700">{error}</p>}
    </div>
  );
}
