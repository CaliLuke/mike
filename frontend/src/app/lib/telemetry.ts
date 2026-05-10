"use client";

/**
 * OpenTelemetry web bootstrap. Creates a single WebTracerProvider, hooks up
 * fetch auto-instrumentation (so fetch calls become spans with W3C trace
 * context propagation), and ships completed spans to the backend at
 * /v1/traces. Idempotent — calling init() more than once is a no-op.
 *
 * Disable in dev by setting NEXT_PUBLIC_OTEL_ENABLED=false.
 */

import { type Span, trace, type Tracer } from "@opentelemetry/api";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { type ExportResult, ExportResultCode } from "@opentelemetry/core";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import {
  BatchSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
  WebTracerProvider,
} from "@opentelemetry/sdk-trace-web";

const SERVICE_NAME = "luke-frontend";

const FLAG = (process.env.NEXT_PUBLIC_OTEL_ENABLED ?? "").toLowerCase();
const ENABLED = FLAG !== "false" && FLAG !== "0" && FLAG !== "no" && FLAG !== "off";

const ENDPOINT = process.env.NEXT_PUBLIC_OTEL_TRACES_URL ?? "http://localhost:3001/v1/traces";

interface IngestSpan {
  trace_id: string;
  span_id: string;
  parent_span_id: string;
  name: string;
  kind: string;
  service: string;
  start_unix_nano: number;
  end_unix_nano: number;
  attributes: Record<string, unknown>;
  status: string;
}

class BackendSpanExporter implements SpanExporter {
  export(spans: ReadableSpan[], resultCallback: (r: ExportResult) => void): void {
    const payload = {
      spans: spans.map<IngestSpan>((s) => ({
        trace_id: s.spanContext().traceId,
        span_id: s.spanContext().spanId,
        parent_span_id: s.parentSpanContext?.spanId ?? "",
        name: s.name,
        kind: String(s.kind),
        service: SERVICE_NAME,
        start_unix_nano: hrTimeToNanos(s.startTime),
        end_unix_nano: hrTimeToNanos(s.endTime),
        attributes: { ...s.attributes },
        status: String(s.status.code),
      })),
    };
    try {
      void fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
      resultCallback({ code: ExportResultCode.SUCCESS });
    } catch {
      resultCallback({ code: ExportResultCode.FAILED });
    }
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

function hrTimeToNanos(hr: [number, number]): number {
  return hr[0] * 1_000_000_000 + hr[1];
}

let initialized = false;

export function initTelemetry(): void {
  if (initialized || !ENABLED || typeof window === "undefined") return;
  initialized = true;

  const provider = new WebTracerProvider({
    spanProcessors: [new BatchSpanProcessor(new BackendSpanExporter())],
  });
  provider.register({ contextManager: new ZoneContextManager() });

  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls: [/.*/],
      }),
    ],
  });
}

export function getTracer(name = SERVICE_NAME): Tracer {
  return trace.getTracer(name);
}

export type { Span };
