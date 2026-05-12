"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";

import { KIND_LABELS } from "@/app/components/files/MetadataBadges";
import type {
  LukeApplication,
  LukeDocument,
  LukeDocumentKind,
  LukeDocumentMetadataPatch,
  LukeInterviewStage,
  LukeLibraryKind,
  LukeMetadataStatus,
  LukePersonRef,
} from "@/app/components/shared/types";
import {
  addDocumentApplicationLink,
  deleteDocumentApplicationLink,
  patchDocumentMetadata,
  processDocumentMetadata,
} from "@/app/lib/documentMetadata";
import { listApplications } from "@/app/lib/lukeApi";

const INTERVIEW_STAGES: { value: LukeInterviewStage; label: string }[] = [
  { value: "recruiter", label: "Recruiter" },
  { value: "hiring_manager", label: "Hiring Manager" },
  { value: "peer", label: "Peer" },
  { value: "tech", label: "Tech" },
  { value: "panel", label: "Panel" },
  { value: "onsite", label: "Onsite" },
  { value: "other", label: "Other" },
];

// Kinds that are reusable across applications by default. Used to derive a
// sensible library / library_kind when the user picks a kind in edit mode.
const LIBRARY_KINDS_BY_DEFAULT = new Set<LukeDocumentKind>([
  "story",
  "about_me",
  "answer_bank",
  "framework",
  "references",
  "cheatsheet",
  "resume_baseline",
  "writing_sample",
]);

const REFERENCE_KINDS = new Set<LukeDocumentKind>(["cheatsheet", "framework"]);

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

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// statusSubtitle returns a calm, prose-style status line ("Classifying…",
// "Classified Dec 12", "Awaiting classification") — replacing the colored
// pill soup. Returns null when the kind already tells the user enough.
function statusSubtitle(doc: LukeDocument): string | null {
  const status = (doc.metadata_status ?? "unprocessed") as LukeMetadataStatus;
  switch (status) {
    case "unprocessed":
      return "Awaiting classification";
    case "queued":
      return "Queued for classification…";
    case "processing":
      return "Classifying…";
    case "error":
      return "Classification failed";
    case "ready":
      return doc.metadata_processed_at
        ? `Suggested ${formatRelative(doc.metadata_processed_at)} — review and confirm`
        : "Awaiting your review";
    case "user_confirmed":
      return doc.metadata_processed_at
        ? `Confirmed ${formatRelative(doc.metadata_processed_at)}`
        : "Confirmed";
    default:
      return null;
  }
}

// MetadataPanel is the read-first detail view for a document's classifier
// output. Default state shows summary + chips. Click "Edit" to switch to a
// compact inline form. The panel is keyed at the callsite so it remounts
// (and re-initialises form state) when the backend lands fresh content.
export function MetadataPanel({ doc, onUpdated }: MetadataPanelProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(() => buildFormState(doc));
  const [saving, setSaving] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = (doc.metadata_status ?? "unprocessed") as LukeMetadataStatus;
  const isUnprocessed = status === "unprocessed" || status === "error";
  const hasContent =
    doc.kind ||
    doc.summary ||
    (doc.topics?.length ?? 0) > 0 ||
    (doc.company_refs?.length ?? 0) > 0 ||
    (doc.people_refs?.length ?? 0) > 0;
  const canConfirm = status === "ready" || status === "user_confirmed";

  async function handleSave(opts: { confirm: boolean }) {
    setError(null);
    setSaving(true);
    try {
      const patch: LukeDocumentMetadataPatch = {
        confirm: opts.confirm,
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
      void queryClient.invalidateQueries({ queryKey: ["metadata-queue"] });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm() {
    // Confirm the *current* persisted state without sending edits.
    setError(null);
    setSaving(true);
    try {
      const updated = await patchDocumentMetadata(trimDocumentRef(doc.id), {
        confirm: true,
      });
      onUpdated(updated);
      void queryClient.invalidateQueries({ queryKey: ["metadata-queue"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClassifying(false);
    }
  }

  if (editing) {
    return (
      <MetadataEditForm
        form={form}
        setForm={setForm}
        saving={saving}
        error={error}
        canConfirm={canConfirm}
        onCancel={() => {
          setForm(buildFormState(doc));
          setEditing(false);
          setError(null);
        }}
        onSave={() => handleSave({ confirm: false })}
        onSaveAndConfirm={() => handleSave({ confirm: true })}
      />
    );
  }

  // --- Read mode ---
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <header className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-serif text-lg text-gray-900">Metadata</h2>
          {statusSubtitle(doc) && (
            <p className="mt-0.5 text-xs text-gray-500">{statusSubtitle(doc)}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {canConfirm && status !== "user_confirmed" && (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={saving}
              className="rounded-md bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-60"
            >
              Confirm
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={saving}
            className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-60"
            title="Edit metadata"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
        </div>
      </header>

      {error && (
        <div className="border-b border-rose-100 bg-rose-50/50 px-5 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}
      {doc.metadata_error && (
        <div className="border-b border-rose-100 bg-rose-50/50 px-5 py-2 text-xs text-rose-700">
          Last classifier error: {doc.metadata_error}
        </div>
      )}

      {isUnprocessed && !hasContent ? (
        <div className="px-5 py-6 text-center">
          <p className="font-serif text-sm text-gray-500">
            No metadata yet. Run the classifier to extract a summary, topics, and references — or
            fill them in by hand.
          </p>
          <div className="mt-3 flex justify-center gap-2">
            <button
              type="button"
              onClick={handleClassify}
              disabled={classifying}
              className="flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-60"
            >
              <Sparkles className="h-3 w-3" />
              {classifying
                ? "Queueing…"
                : status === "error"
                  ? "Retry classification"
                  : "Classify this document"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
            >
              Fill in by hand
            </button>
          </div>
        </div>
      ) : (
        <ReadView doc={doc} onClassify={handleClassify} classifying={classifying} />
      )}

      {doc.library ? <LibraryLinksSection doc={doc} onUpdated={onUpdated} /> : null}
    </section>
  );
}

// ReadView renders the persisted metadata as prose + chips. No form controls
// in this mode — that's the whole point of read-first.
function ReadView({
  doc,
  onClassify,
  classifying,
}: {
  doc: LukeDocument;
  onClassify: () => void;
  classifying: boolean;
}) {
  const kindLabel = doc.kind ? (KIND_LABELS[doc.kind] ?? doc.kind) : null;
  const scopeLabel = doc.library
    ? doc.library_kind === "reference"
      ? "Reference material"
      : "Library asset"
    : "Application-specific";

  const stageLabel = doc.interview_stage
    ? INTERVIEW_STAGES.find((s) => s.value === doc.interview_stage)?.label
    : null;

  return (
    <div className="space-y-4 px-5 py-4">
      {/* Kind + scope subtitle */}
      {kindLabel && (
        <p className="font-serif text-sm text-gray-600">
          <span className="text-gray-900">{kindLabel}</span>
          <span className="mx-1.5 text-gray-300">·</span>
          <span>{scopeLabel}</span>
          {stageLabel && (
            <>
              <span className="mx-1.5 text-gray-300">·</span>
              <span>{stageLabel} interview</span>
            </>
          )}
          {doc.dated_event_at && (
            <>
              <span className="mx-1.5 text-gray-300">·</span>
              <span>{formatRelative(doc.dated_event_at)}</span>
            </>
          )}
        </p>
      )}

      {/* Summary as prose, the centerpiece. */}
      {doc.summary ? (
        <p className="font-serif text-base leading-relaxed text-gray-900">{doc.summary}</p>
      ) : (
        <p className="font-serif text-sm text-gray-400">
          No summary yet.{" "}
          <button
            type="button"
            onClick={onClassify}
            disabled={classifying}
            className="text-gray-600 underline-offset-2 hover:underline disabled:opacity-60"
          >
            {classifying ? "Queueing…" : "Run the classifier"}
          </button>
          .
        </p>
      )}

      <ChipRow label="Topics" items={doc.topics ?? []} />
      <ChipRow label="Companies mentioned" items={doc.company_refs ?? []} />

      {(doc.people_refs?.length ?? 0) > 0 && (
        <div className="space-y-1">
          <div className="text-xs tracking-wide text-gray-400 uppercase">People</div>
          <ul className="font-serif text-sm text-gray-700">
            {(doc.people_refs ?? []).map((p, i) => (
              <li key={i}>
                {p.name}
                {p.role ? <span className="text-gray-400"> — {p.role}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ChipRow({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs tracking-wide text-gray-400 uppercase">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <span
            key={i}
            className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

// MetadataEditForm is the compact edit-mode UI. Same fields, but visually
// recessed so the user understands they're temporarily in a write state.
function MetadataEditForm({
  form,
  setForm,
  saving,
  error,
  canConfirm,
  onCancel,
  onSave,
  onSaveAndConfirm,
}: {
  form: FormState;
  setForm: (next: FormState) => void;
  saving: boolean;
  error: string | null;
  canConfirm: boolean;
  onCancel: () => void;
  onSave: () => void;
  onSaveAndConfirm: () => void;
}) {
  function addPerson() {
    setForm({ ...form, peopleRefs: [...form.peopleRefs, { name: "", role: "" }] });
  }
  function updatePerson(i: number, patch: Partial<LukePersonRef>) {
    setForm({
      ...form,
      peopleRefs: form.peopleRefs.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    });
  }
  function removePerson(i: number) {
    setForm({
      ...form,
      peopleRefs: form.peopleRefs.filter((_, idx) => idx !== i),
    });
  }

  // When the user changes kind, derive library / library_kind defaults so
  // they don't have to think about scope as a separate concept. They can
  // still override via the "Treat as library asset" toggle below.
  function setKind(nextKind: LukeDocumentKind) {
    const isLibrary = LIBRARY_KINDS_BY_DEFAULT.has(nextKind);
    const isReference = REFERENCE_KINDS.has(nextKind);
    setForm({
      ...form,
      kind: nextKind,
      library: isLibrary,
      libraryKind: isLibrary ? (isReference ? "reference" : "shared") : "",
    });
  }

  return (
    <section className="rounded-lg border border-gray-300 bg-gray-50/60">
      <header className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
        <h2 className="font-serif text-base text-gray-900">Edit metadata</h2>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900"
          title="Cancel"
        >
          <X className="h-3 w-3" />
          Cancel
        </button>
      </header>

      {error && (
        <div className="border-b border-rose-100 bg-rose-50/50 px-5 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      <div className="space-y-4 px-5 py-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind">
            <select
              className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 font-serif text-sm text-gray-900"
              value={form.kind}
              onChange={(e) => setKind(e.target.value as LukeDocumentKind)}
            >
              {Object.entries(KIND_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Interview stage">
            <select
              className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 font-serif text-sm text-gray-900"
              value={form.interviewStage}
              onChange={(e) =>
                setForm({ ...form, interviewStage: e.target.value as LukeInterviewStage | "" })
              }
            >
              <option value="">— not applicable —</option>
              {INTERVIEW_STAGES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Summary">
          <textarea
            className="min-h-[72px] w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 font-serif text-sm leading-relaxed text-gray-900"
            value={form.summary}
            onChange={(e) => setForm({ ...form, summary: e.target.value })}
            placeholder="2-4 sentences describing what the document is."
          />
        </Field>

        <Field label="Topics">
          <input
            className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 font-serif text-sm text-gray-900"
            value={form.topicsText}
            onChange={(e) => setForm({ ...form, topicsText: e.target.value })}
            placeholder="comma, separated, tags"
          />
        </Field>

        <Field label="Companies mentioned">
          <input
            className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 font-serif text-sm text-gray-900"
            value={form.companyRefsText}
            onChange={(e) => setForm({ ...form, companyRefsText: e.target.value })}
            placeholder="comma, separated"
          />
        </Field>

        <Field label="People referenced">
          <div className="space-y-1.5">
            {form.peopleRefs.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className="flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 font-serif text-sm text-gray-900"
                  placeholder="Name"
                  value={p.name}
                  onChange={(e) => updatePerson(i, { name: e.target.value })}
                />
                <input
                  className="flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 font-serif text-sm text-gray-900"
                  placeholder="Role"
                  value={p.role ?? ""}
                  onChange={(e) => updatePerson(i, { role: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => removePerson(i)}
                  className="text-xs text-gray-400 hover:text-rose-600"
                >
                  remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addPerson}
              className="text-xs text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline"
            >
              + add person
            </button>
          </div>
        </Field>

        <Field label="Event date">
          <input
            type="text"
            className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 font-serif text-sm text-gray-900"
            value={form.datedEventAt}
            onChange={(e) => setForm({ ...form, datedEventAt: e.target.value })}
            placeholder="2025-11-25T00:00:00Z (ISO 8601)"
          />
        </Field>

        <Field label="Scope">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.library}
              onChange={(e) =>
                setForm({
                  ...form,
                  library: e.target.checked,
                  libraryKind: e.target.checked ? form.libraryKind || "shared" : "",
                })
              }
            />
            <span>Reusable library asset</span>
            {form.library && (
              <select
                className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs"
                value={form.libraryKind}
                onChange={(e) =>
                  setForm({ ...form, libraryKind: e.target.value as LukeLibraryKind | "" })
                }
              >
                <option value="shared">My material</option>
                <option value="reference">External reference</option>
              </select>
            )}
          </label>
        </Field>
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900 disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {canConfirm && (
          <button
            type="button"
            onClick={onSaveAndConfirm}
            disabled={saving}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save & confirm"}
          </button>
        )}
      </footer>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs tracking-wide text-gray-400 uppercase">{label}</div>
      {children}
    </div>
  );
}

// LibraryLinksSection lists applications this library doc is linked to,
// with subtle chip controls — no select-box-and-button form bolted on.
function LibraryLinksSection({
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

  const linkedApps = (doc.linked_application_ids ?? [])
    .map((ref) => trimApplicationRef(ref) ?? ref)
    .map((id) => ({
      id,
      name: applications.find((a) => trimApplicationRef(a.id) === id)?.name ?? id,
    }));

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
      setError(e instanceof Error ? e.message : String(e));
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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-gray-100 px-5 py-4">
      <div className="text-xs tracking-wide text-gray-400 uppercase">
        Applications using this document
      </div>
      {linkedApps.length === 0 ? (
        <p className="font-serif text-sm text-gray-500">Not linked to any application yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {linkedApps.map((a) => (
            <li
              key={a.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-700"
            >
              <span>{a.name}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => removeLink(a.id)}
                className="text-gray-400 hover:text-rose-600 disabled:opacity-60"
                title="Remove link"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {candidates.length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <select
            className="flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs"
            value={addingId}
            onChange={(e) => setAddingId(e.target.value)}
            disabled={busy}
          >
            <option value="">— link to application —</option>
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
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Link
          </button>
        </div>
      )}
      {error && <p className="text-xs text-rose-700">{error}</p>}
    </div>
  );
}
