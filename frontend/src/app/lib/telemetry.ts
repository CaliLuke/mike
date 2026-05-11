"use client";

/**
 * OpenTelemetry web bootstrap. Creates a single WebTracerProvider, hooks up
 * fetch auto-instrumentation (so fetch calls become spans with W3C trace
 * context propagation), and ships completed spans to the backend at
 * /v1/traces. Idempotent — calling init() more than once is a no-op.
 *
 * Disable in dev by setting NEXT_PUBLIC_OTEL_ENABLED=false.
 */

import {
  type AttributeValue,
  type Span,
  SpanStatusCode,
  trace,
  type Tracer,
} from "@opentelemetry/api";
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

  installErrorReporter();
}

/**
 * Hook the global window error sinks so unhandled exceptions and rejected
 * promises become OTel spans (status=ERROR, name=`frontend.runtime_error`).
 * They flow through the same BatchSpanProcessor as everything else and land
 * in the backend `telemetry.sqlite` spans table.
 */
function installErrorReporter(): void {
  const tracer = getTracer("luke-frontend.errors");

  const emit = (
    name: string,
    message: string,
    attrs: Record<string, unknown>,
    error?: unknown,
  ): void => {
    const span = tracer.startSpan(name);
    span.setAttribute("error.message", message);
    span.setAttribute("page.url", window.location.href);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null) continue;
      span.setAttribute(k, typeof v === "object" ? JSON.stringify(v) : (v as never));
    }
    if (error instanceof Error) {
      span.recordException(error);
      if (error.stack) span.setAttribute("error.stack", error.stack);
      span.setAttribute("error.name", error.name);
    } else if (typeof error === "string") {
      span.setAttribute("error.value", error);
    }
    span.setStatus({ code: SpanStatusCode.ERROR, message });
    span.end();
  };

  window.addEventListener("error", (event) => {
    emit(
      "frontend.runtime_error",
      event.message || "uncaught error",
      {
        "error.source": event.filename,
        "error.line": event.lineno,
        "error.col": event.colno,
      },
      event.error,
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "unhandled promise rejection";
    emit("frontend.unhandled_rejection", message, {}, reason);
  });

  // Mirror console.error so React's dev-time error overlay output is also
  // captured. Tag the span name differently so it can be filtered out if
  // it's too noisy.
  const origConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      const first = args[0];
      const message =
        first instanceof Error
          ? first.message
          : args
              .map((a) =>
                typeof a === "string" ? a : a instanceof Error ? a.message : safeStringify(a),
              )
              .join(" ");
      emit(
        "frontend.console_error",
        message,
        { "error.argv": safeStringify(args.slice(1, 6)) },
        first,
      );
    } catch {
      // never let logging break the original console.error
    }
    origConsoleError(...args);
  };
}

function safeStringify(v: unknown): string {
  try {
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function getTracer(name = SERVICE_NAME): Tracer {
  return trace.getTracer(name);
}

/**
 * Emit a zero-duration span for a UI interaction. Use named events
 * (`chat.send`, `file.upload.click`) so traces are easy to filter and
 * stable across copy changes. Strip null/undefined so callers can pass
 * conditional attributes without guarding each one.
 */
export function trackClick(
  name: string,
  attributes: Record<string, AttributeValue | null | undefined> = {},
): void {
  const span = getTracer("luke-frontend.ui").startSpan(name);
  for (const [k, v] of Object.entries(attributes)) {
    if (v === undefined || v === null) continue;
    span.setAttribute(k, v);
  }
  span.end();
}

export type { Span };
