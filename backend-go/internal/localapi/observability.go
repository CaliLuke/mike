package localapi

import (
	"context"
	"strings"
	"unicode"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

var localapiTracer = otel.Tracer("luke/localapi")

func startLocalSpan(ctx context.Context, name string, attrs ...attribute.KeyValue) (context.Context, trace.Span) {
	ctx, span := localapiTracer.Start(ctx, name)
	if len(attrs) > 0 {
		span.SetAttributes(attrs...)
	}
	return ctx, span
}

func recordSpanError(span trace.Span, err error) {
	if err == nil {
		return
	}
	span.RecordError(err)
	span.SetStatus(codes.Error, err.Error())
}

func surrealQueryAttributes(query string) []attribute.KeyValue {
	operation, target := summarizeSurrealQuery(query)
	attrs := []attribute.KeyValue{
		attribute.String("db.system", "surrealdb"),
		attribute.String("db.operation", operation),
	}
	if target != "" {
		attrs = append(attrs, attribute.String("db.target", target))
	}
	return attrs
}

func summarizeSurrealQuery(query string) (string, string) {
	fields := strings.FieldsFunc(query, func(r rune) bool {
		return unicode.IsSpace(r) || r == ';' || r == ',' || r == '(' || r == ')' || r == '{' || r == '}'
	})
	if len(fields) == 0 {
		return "unknown", ""
	}
	operation := strings.ToUpper(fields[0])
	target := ""
	for i, field := range fields {
		upper := strings.ToUpper(field)
		switch upper {
		case "FROM", "TABLE", "INTO":
			if i+1 < len(fields) {
				target = normalizeSurrealTarget(fields[i+1])
			}
		case "CREATE", "UPDATE", "DELETE", "UPSERT":
			if i+1 < len(fields) && target == "" {
				target = normalizeSurrealTarget(fields[i+1])
			}
		}
		if target != "" {
			break
		}
	}
	return operation, target
}

func normalizeSurrealTarget(value string) string {
	value = strings.Trim(value, "`\"'")
	if idx := strings.IndexByte(value, ':'); idx >= 0 {
		return value[:idx]
	}
	return value
}
