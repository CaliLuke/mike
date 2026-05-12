"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { DataTable } from "@/app/components/shared/DataTable";
import { HeaderSearchBtn } from "@/app/components/shared/HeaderSearchBtn";
import { RowMenu } from "@/app/components/shared/RowMenu";
import type { LukeCompany } from "@/app/components/shared/types";
import { createCompany, deleteCompany, listCompanies } from "@/app/lib/lukeApi";

import { EditCompanyModal } from "./EditCompanyModal";

const columnHelper = createColumnHelper<LukeCompany>();

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const COMPANIES_KEY = ["companies"] as const;

export function CompaniesOverview() {
  const queryClient = useQueryClient();
  const { data: companies = [], isLoading: loading } = useQuery<LukeCompany[]>({
    queryKey: COMPANIES_KEY,
    queryFn: listCompanies,
  });
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [editingCompany, setEditingCompany] = useState<LukeCompany | null>(null);

  const mutateCompanies = (fn: (prev: LukeCompany[]) => LukeCompany[]) =>
    queryClient.setQueryData<LukeCompany[]>(COMPANIES_KEY, (prev) => fn(prev ?? []));

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const created = await createCompany(trimmed, website.trim() || undefined);
    mutateCompanies((prev) => [created, ...prev]);
    setName("");
    setWebsite("");
    setCreating(false);
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

      <CompaniesTable
        companies={companies}
        loading={loading}
        onEdit={(company) => setEditingCompany(company)}
        onDelete={async (id) => {
          await deleteCompany(id);
          mutateCompanies((prev) => prev.filter((item) => item.id !== id));
        }}
        search={search}
        onSearchChange={setSearch}
      />

      <EditCompanyModal
        open={editingCompany !== null}
        company={editingCompany}
        onClose={() => setEditingCompany(null)}
        onUpdated={(updated) => {
          mutateCompanies((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        }}
      />
    </div>
  );
}

interface CompaniesTableProps {
  companies: LukeCompany[];
  loading: boolean;
  onEdit: (company: LukeCompany) => void;
  onDelete: (companyId: string) => Promise<void>;
  search: string;
  onSearchChange: (value: string) => void;
}

function CompaniesTable({
  companies,
  loading,
  onEdit,
  onDelete,
  search,
  onSearchChange,
}: CompaniesTableProps) {
  const columns = [
    columnHelper.accessor("name", {
      header: "Name",
      cell: (info) => <span className="truncate">{info.getValue()}</span>,
    }),
    columnHelper.accessor("website", {
      header: "Website",
      size: 220,
      cell: (info) => {
        const website = info.getValue();
        return website ? (
          <span className="truncate text-gray-500">{website}</span>
        ) : (
          <span className="text-gray-300">-</span>
        );
      },
    }),
    columnHelper.accessor("application_count", {
      header: "Applications",
      size: 100,
      cell: (info) => <span className="text-gray-500 tabular-nums">{info.getValue() ?? 0}</span>,
    }),
    columnHelper.accessor("created_at", {
      header: "Created",
      size: 110,
      cell: (info) => <span className="text-gray-500">{formatDate(info.getValue())}</span>,
      sortingFn: "datetime",
    }),
    columnHelper.display({
      id: "actions",
      header: "",
      size: 56,
      enableSorting: false,
      cell: (info) => (
        <div className="flex justify-end" data-row-action onClick={(e) => e.stopPropagation()}>
          <RowMenu
            ariaLabel={`Actions for ${info.row.original.name}`}
            items={[
              {
                label: "Edit",
                icon: Pencil,
                onClick: () => onEdit(info.row.original),
              },
              {
                label: "Delete",
                icon: Trash2,
                destructive: true,
                onClick: () => void onDelete(info.row.original.id),
              },
            ]}
          />
        </div>
      ),
    }),
  ];

  return (
    <DataTable
      data={companies}
      columns={columns}
      globalFilter={search}
      onGlobalFilterChange={onSearchChange}
      globalFilterFn={(row, _id, value) => {
        const q = value.toLowerCase();
        if (!q) return true;
        const company = row.original;
        return (
          company.name.toLowerCase().includes(q) ||
          (company.website ?? "").toLowerCase().includes(q)
        );
      }}
      initialSorting={[{ id: "created_at", desc: true }]}
      isLoading={loading}
      loadingNode={
        <div className="space-y-2 px-8 py-5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 w-80 animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      }
      emptyNode={
        <div className="mx-auto flex w-full max-w-xs flex-col items-start py-24">
          <Building2 className="mb-4 h-8 w-8 text-gray-300" />
          <p className="font-serif text-2xl font-medium text-gray-900">Companies</p>
          <p className="mt-1 max-w-xs text-xs text-gray-400">
            Add companies, then attach each application to the company it belongs to.
          </p>
        </div>
      }
      emptyFilteredNode={
        <div className="px-8 py-6 text-sm text-gray-500">No companies match that search.</div>
      }
    />
  );
}
