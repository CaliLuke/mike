"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { createApplication, listCompanies } from "@/app/lib/lukeApi";

import type { LukeApplication, LukeCompany } from "../shared/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (application: LukeApplication) => void;
}

interface CompanyChoice {
  /** When set, the user picked an existing company. */
  id?: string;
  /** Display + payload name in either case. */
  name: string;
}

export function NewApplicationModal({ open, onClose, onCreated }: Props) {
  const { data: companies = [] } = useQuery<LukeCompany[]>({
    queryKey: ["companies"],
    queryFn: listCompanies,
    enabled: open,
  });

  const [jobUrl, setJobUrl] = useState("");
  const [position, setPosition] = useState("");
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyChoice, setCompanyChoice] = useState<CompanyChoice | null>(null);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const companyInputRef = useRef<HTMLInputElement>(null);

  const trimmedQuery = companyQuery.trim();
  const filteredCompanies = useMemo(() => {
    const q = trimmedQuery.toLowerCase();
    if (!q) return companies.slice(0, 8);
    return companies.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
  }, [companies, trimmedQuery]);

  if (!open) return null;

  const exactMatch = companies.find(
    (c) => c.name.trim().toLowerCase() === trimmedQuery.toLowerCase(),
  );
  const showCreateOption = trimmedQuery.length > 0 && !exactMatch;

  function pickExisting(company: LukeCompany) {
    setCompanyChoice({ id: company.id, name: company.name });
    setCompanyQuery(company.name);
    setCompanyOpen(false);
  }

  function pickNew(name: string) {
    setCompanyChoice({ name });
    setCompanyQuery(name);
    setCompanyOpen(false);
  }

  function clearCompany() {
    setCompanyChoice(null);
    setCompanyQuery("");
    setCompanyOpen(true);
    companyInputRef.current?.focus();
  }

  // Anything is fine — even a fully empty form. Without a company, the
  // backend files the application under the "Unknown" placeholder; the
  // assistant can identify the real company from the materials later.
  const canSubmit = !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError("");
    // If the user typed a name but never picked a dropdown option, treat the
    // raw text as either the matched existing company or a brand-new one.
    const effectiveChoice: CompanyChoice =
      companyChoice ??
      (exactMatch ? { id: exactMatch.id, name: exactMatch.name } : { name: trimmedQuery });
    try {
      const application = await createApplication({
        company_id: effectiveChoice.id,
        company_name: effectiveChoice.id ? undefined : effectiveChoice.name,
        position: position.trim() || undefined,
        job_description_url: jobUrl.trim() || undefined,
      });
      onCreated(application);
      resetForm();
      onClose();
    } catch (err: unknown) {
      setError((err as Error).message || "Failed to create application");
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setJobUrl("");
    setPosition("");
    setCompanyQuery("");
    setCompanyChoice(null);
    setCompanyOpen(false);
    setError("");
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-101 flex items-center justify-center bg-black/20 backdrop-blur-xs">
      <div className="flex w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span>Applications</span>
            <span>›</span>
            <span>New application</span>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="space-y-4 px-6 pt-3 pb-5">
            <p className="font-serif text-2xl text-gray-800">New application</p>
            <p className="-mt-2 text-xs text-gray-400">
              Add a link to the posting, a position, or a company — anything you have. If you skip
              the company, the assistant will figure it out from the materials.
            </p>

            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600" htmlFor="job-url">
                Job description URL
              </label>
              <input
                id="job-url"
                type="url"
                value={jobUrl}
                onChange={(e) => setJobUrl(e.target.value)}
                placeholder="https://…"
                autoFocus
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none placeholder:text-gray-300 focus:border-gray-400"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600" htmlFor="position">
                Position
              </label>
              <input
                id="position"
                type="text"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                placeholder="e.g. Senior Engineer"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none placeholder:text-gray-300 focus:border-gray-400"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-600" htmlFor="company">
                Company
              </label>
              <div className="relative">
                <input
                  id="company"
                  ref={companyInputRef}
                  type="text"
                  value={companyQuery}
                  onChange={(e) => {
                    setCompanyQuery(e.target.value);
                    setCompanyChoice(null);
                    setCompanyOpen(true);
                  }}
                  onFocus={() => setCompanyOpen(true)}
                  onBlur={() => {
                    // Defer to allow option-click to fire first.
                    setTimeout(() => setCompanyOpen(false), 120);
                  }}
                  placeholder="Search or add a company (optional)"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none placeholder:text-gray-300 focus:border-gray-400"
                />
                {companyChoice && (
                  <button
                    type="button"
                    onClick={clearCompany}
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    aria-label="Clear company"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                {companyOpen && (filteredCompanies.length > 0 || showCreateOption) && (
                  <div className="absolute top-full right-0 left-0 z-10 mt-1 max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                    {filteredCompanies.map((company) => {
                      const selected = companyChoice?.id === company.id;
                      return (
                        <button
                          key={company.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickExisting(company)}
                          className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                        >
                          <span className="truncate">{company.name}</span>
                          {selected && <Check className="h-3.5 w-3.5 text-gray-400" />}
                        </button>
                      );
                    })}
                    {showCreateOption && (
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickNew(trimmedQuery)}
                        className="flex w-full items-center gap-2 border-t border-gray-100 px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <Plus className="h-3.5 w-3.5 text-gray-400" />
                        <span className="truncate">
                          Add &ldquo;{trimmedQuery}&rdquo; as a new company
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>
              {companyChoice && !companyChoice.id && (
                <p className="text-xs text-gray-400">New company will be created on submit.</p>
              )}
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg px-4 py-2 text-sm text-gray-500 transition-colors hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-40"
            >
              {loading ? "Creating…" : "Create application"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
