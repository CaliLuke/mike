import type { Span } from "@opentelemetry/api";

import { getTracer, trackClick } from "@/app/lib/telemetry";

/**
 * Spike-local observability helpers. Every span / event name is
 * prefixed with `assistant_next.` so it's easy to filter in traces.
 *
 * Use:
 * - `aniEvent` for fire-and-forget UI interactions (button click,
 *   attachment selected, citation tapped). Same shape as the existing
 *   `trackClick` — picked here for consistency with the legacy chat.
 * - `aniSpan` for long-running async work where you want the span
 *   open while the work runs. Always `.end()` in finally.
 * - `aniWrap` for the common pattern: "start span, do async work,
 *   record exception on throw, end span".
 *
 * Attribute values are strict OTel JSON-able primitives; the helpers
 * coerce `null`/`undefined` away so callers don't have to guard.
 */
const PREFIX = "assistant_next.";

type AttrValue = string | number | boolean | null | undefined;
type AttrBag = Record<string, AttrValue>;

const NS = "luke-frontend.assistant-next";

function applyAttrs(span: Span, attrs: AttrBag | undefined): void {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    span.setAttribute(k, v);
  }
}

export function aniEvent(name: string, attrs?: AttrBag): void {
  trackClick(PREFIX + name, attrs);
}

export function aniSpan(name: string, attrs?: AttrBag): Span {
  const span = getTracer(NS).startSpan(PREFIX + name);
  applyAttrs(span, attrs);
  return span;
}

export async function aniWrap<T>(
  name: string,
  attrs: AttrBag | undefined,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const span = aniSpan(name, attrs);
  try {
    return await fn(span);
  } catch (err) {
    if (err instanceof Error) span.recordException(err);
    span.setAttribute("error", true);
    throw err;
  } finally {
    span.end();
  }
}
