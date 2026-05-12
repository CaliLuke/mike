import type { Unstable_TriggerAdapter, Unstable_TriggerItem } from "@assistant-ui/core";

import type { LukeApplication, LukeCompany, LukeWorkflow } from "@/app/components/shared/types";

const fuzzyMatch = (q: string, ...fields: (string | null | undefined)[]) =>
  fields.some((f) => f?.toLowerCase().includes(q.toLowerCase()));

/**
 * Adapter for the `@` trigger — companies and applications shown as
 * two categories. Items are `Directive`-inserted as chips into the
 * composer text so the backend sees `@CompanyName` in the prompt.
 */
export function buildMentionAdapter(
  companies: readonly LukeCompany[],
  applications: readonly LukeApplication[],
): Unstable_TriggerAdapter {
  const companyItems: Unstable_TriggerItem[] = companies.map((c) => ({
    id: `company:${c.id}`,
    type: "company",
    label: c.name,
    description: c.website ?? undefined,
    metadata: { company_id: c.id },
  }));
  const applicationItems: Unstable_TriggerItem[] = applications.map((a) => ({
    id: `application:${a.id}`,
    type: "application",
    label: a.name,
    description: a.company_name ?? undefined,
    metadata: { application_id: a.id, company_id: a.company_id },
  }));

  return {
    categories: () => [
      { id: "companies", label: "Companies" },
      { id: "applications", label: "Applications" },
    ],
    categoryItems: (categoryId) =>
      categoryId === "companies"
        ? companyItems
        : categoryId === "applications"
          ? applicationItems
          : [],
    search: (query) => {
      if (!query) return [...companyItems, ...applicationItems];
      return [...companyItems, ...applicationItems].filter((item) =>
        fuzzyMatch(query, item.label, item.description),
      );
    },
  };
}

/**
 * Adapter for the `/` trigger — assistant workflows. Items fire an
 * `onExecute` action (not Directive) so the host can attach the chosen
 * workflow to the next message instead of inserting raw text.
 *
 * No categories — workflows are the only thing here, so skipping the
 * category drill-down jumps the user straight into the item list.
 * (`triggerNavigationResource` triggers search-mode when `categories`
 * is empty + an `adapter.search` is provided, so items render without
 * a query.)
 */
export function buildSlashAdapter(workflows: readonly LukeWorkflow[]): Unstable_TriggerAdapter {
  const items: Unstable_TriggerItem[] = workflows.map((w) => ({
    id: `workflow:${w.id}`,
    type: "workflow",
    label: w.title,
    description: w.prompt_md ? w.prompt_md.slice(0, 80) : undefined,
    metadata: { workflow_id: w.id, title: w.title },
  }));

  return {
    categories: () => [],
    categoryItems: () => items,
    search: (query) =>
      query ? items.filter((it) => fuzzyMatch(query, it.label, it.description)) : items,
  };
}
