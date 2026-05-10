"use client";

import { Building2, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { HeaderSearchBtn } from "@/app/components/shared/HeaderSearchBtn";
import type { LukeCompany } from "@/app/components/shared/types";
import { createCompany, deleteCompany, listCompanies, updateCompany } from "@/app/lib/lukeApi";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function CompaniesOverview() {
  const [companies, setCompanies] = useState<LukeCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingWebsite, setEditingWebsite] = useState("");

  useEffect(() => {
    listCompanies()
      .then(setCompanies)
      .catch(() => setCompanies([]))
      .finally(() => setLoading(false));
  }, []);

  const q = search.toLowerCase();
  const filtered = companies.filter(
    (company) =>
      !q ||
      company.name.toLowerCase().includes(q) ||
      (company.website ?? "").toLowerCase().includes(q),
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const created = await createCompany(trimmed, website.trim() || undefined);
    setCompanies((prev) => [created, ...prev]);
    setName("");
    setWebsite("");
    setCreating(false);
  }

  async function commitEdit(company: LukeCompany) {
    const trimmed = editingName.trim();
    setEditingId(null);
    if (!trimmed) return;
    const updated = await updateCompany(company.id, {
      name: trimmed,
      website: editingWebsite.trim() || undefined,
    });
    setCompanies((prev) => prev.map((item) => (item.id === company.id ? updated : item)));
  }

  return (
    <div className="flex-1 overflow-y-auto bg-white">
      <div className="flex items-center justify-between px-8 py-4">
        <h1 className="font-serif text-2xl font-medium text-gray-900">Companies</h1>
        <div className="flex items-center gap-2">
          <HeaderSearchBtn value={search} onChange={setSearch} placeholder="Search companies..." />
          <button
            onClick={() => setCreating(true)}
            className="flex items-center justify-center p-1.5 text-gray-500 transition-colors hover:text-gray-900"
            title="Add company"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="border-t border-gray-100" />

      {creating && (
        <form
          onSubmit={handleCreate}
          className="flex h-12 items-center gap-3 border-b border-gray-100 px-8"
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Company name"
            className="w-72 bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-300"
          />
          <input
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="Website"
            className="w-72 bg-transparent text-sm text-gray-500 outline-none placeholder:text-gray-300"
          />
          <button className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white">
            Create
          </button>
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="rounded-md px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100"
          >
            Cancel
          </button>
        </form>
      )}

      {loading ? (
        <div className="space-y-2 px-8 py-5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 w-80 animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="mx-auto flex w-full max-w-xs flex-col items-start py-24">
          <Building2 className="mb-4 h-8 w-8 text-gray-300" />
          <p className="font-serif text-2xl font-medium text-gray-900">Companies</p>
          <p className="mt-1 max-w-xs text-xs text-gray-400">
            Add companies, then attach each application to the company it belongs to.
          </p>
        </div>
      ) : (
        <div className="min-w-max">
          <div className="flex h-8 items-center border-b border-gray-200 px-8 text-xs font-medium text-gray-500">
            <div className="w-[360px] shrink-0">Name</div>
            <div className="w-[300px] shrink-0">Website</div>
            <div className="w-32 shrink-0">Applications</div>
            <div className="w-32 shrink-0">Created</div>
            <div className="w-24 shrink-0" />
          </div>
          {filtered.map((company) => (
            <div
              key={company.id}
              className="flex h-10 items-center border-b border-gray-50 px-8 text-sm"
            >
              <div className="w-[360px] shrink-0 truncate text-gray-800">
                {editingId === company.id ? (
                  <input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitEdit(company);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onBlur={() => void commitEdit(company)}
                    className="w-full bg-transparent outline-none"
                  />
                ) : (
                  company.name
                )}
              </div>
              <div className="w-[300px] shrink-0 truncate text-gray-500">
                {editingId === company.id ? (
                  <input
                    value={editingWebsite}
                    onChange={(e) => setEditingWebsite(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitEdit(company);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="w-full bg-transparent outline-none"
                  />
                ) : (
                  company.website || <span className="text-gray-300">-</span>
                )}
              </div>
              <div className="w-32 shrink-0 text-gray-500">{company.application_count ?? 0}</div>
              <div className="w-32 shrink-0 text-gray-500">{formatDate(company.created_at)}</div>
              <div className="flex w-24 shrink-0 gap-3 text-xs">
                <button
                  onClick={() => {
                    setEditingId(company.id);
                    setEditingName(company.name);
                    setEditingWebsite(company.website ?? "");
                  }}
                  className="text-gray-500 hover:text-gray-900"
                >
                  Rename
                </button>
                <button
                  onClick={async () => {
                    await deleteCompany(company.id);
                    setCompanies((prev) => prev.filter((item) => item.id !== company.id));
                  }}
                  className="text-red-500 hover:text-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
