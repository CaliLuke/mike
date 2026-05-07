import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir =
  process.env.FIXTURE_DIR ?? path.resolve(here, "..", "fixtures");
const apiBase = process.env.API_BASE ?? "http://localhost:3001";
const authToken = process.env.AUTH_TOKEN ?? "";

const cases = [
  {
    name: "json-health",
    transport: "rest-json",
    request: { method: "GET", path: "/health" },
    response: { contentTypeIncludes: "application/json", requiredFields: ["ok"] },
  },
  {
    name: "json-profile",
    transport: "rest-json",
    request: {
      method: "POST",
      path: "/user/profile",
      body: { display_name: "Fixture User", organisation: "Fixture Org" },
    },
    response: { contentTypeIncludes: "application/json", requiredFields: ["ok"] },
  },
  {
    name: "upload-document",
    transport: "multipart-upload",
    request: {
      method: "POST",
      path: "/single-documents",
      multipartFields: { file: "sample.txt" },
    },
    response: {
      contentTypeIncludes: "application/json",
      requiredFields: ["id", "filename", "file_type", "status"],
    },
  },
  {
    name: "binary-docx-download",
    transport: "binary-download",
    request: {
      method: "GET",
      path: "/single-documents/{documentId}/docx?version_id={versionId}",
    },
    response: {
      contentTypeIncludes:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
  },
  {
    name: "sse-global-chat",
    transport: "sse",
    request: {
      method: "POST",
      path: "/chat",
      body: {
        messages: [{ role: "user", content: "Fixture hello" }],
        model: "gemma4",
      },
    },
    response: {
      contentTypeIncludes: "text/event-stream",
      allowedEventNames: ["message"],
      requiredPayloadTypes: ["chat_id", "content_delta", "citations", "done"],
    },
  },
  {
    name: "sse-project-chat",
    transport: "sse",
    request: {
      method: "POST",
      path: "/projects/{projectId}/chat",
      body: {
        messages: [{ role: "user", content: "Fixture project hello" }],
        model: "gemma4",
      },
    },
    response: {
      contentTypeIncludes: "text/event-stream",
      allowedEventNames: ["message"],
      requiredPayloadTypes: ["chat_id", "content_delta", "citations", "done"],
    },
  },
  {
    name: "sse-tabular-generate",
    transport: "sse",
    request: {
      method: "POST",
      path: "/tabular-review/{reviewId}/generate",
      body: {},
    },
    response: {
      contentTypeIncludes: "text/event-stream",
      allowedEventNames: ["message"],
      requiredPayloadTypes: ["cell_update", "done"],
    },
  },
  {
    name: "sse-tabular-chat",
    transport: "sse",
    request: {
      method: "POST",
      path: "/tabular-review/{reviewId}/chat",
      body: {
        messages: [{ role: "user", content: "Fixture tabular hello" }],
      },
    },
    response: {
      contentTypeIncludes: "text/event-stream",
      allowedEventNames: ["message"],
      requiredPayloadTypes: ["chat_id", "content_delta", "citations", "done"],
    },
  },
];

await mkdir(fixtureDir, { recursive: true });

for (const item of cases) {
  const prepared = await prepareRequest(item);
  if (!prepared.ok) {
    console.log(`skipping ${item.name}: ${prepared.error}`);
    continue;
  }

  const response = await fetch(`${apiBase}${prepared.path}`, {
    method: item.request.method,
    headers: prepared.headers,
    body: prepared.body,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const fixture = {
    name: item.name,
    transport: item.transport,
    request: item.request,
    response: {
      status: response.status,
      contentTypeIncludes: item.response.contentTypeIncludes,
      requiredFields: item.response.requiredFields,
      allowedEventNames: item.response.allowedEventNames,
      requiredPayloadTypes: item.response.requiredPayloadTypes,
      payloadSchemas: defaultPayloadSchemas(item.transport),
    },
  };

  if (item.transport === "sse") {
    const text = await response.text();
    fixture.response.capturedPayloadTypes = parseSse(text).map(
      (event) => event.payloadType,
    );
  } else if (contentType.includes("application/json")) {
    fixture.response.sample = redact(await response.json());
  } else {
    await response.arrayBuffer();
  }

  await writeFile(
    path.join(fixtureDir, `${item.name}.json`),
    `${JSON.stringify(fixture, null, 2)}\n`,
  );
  console.log(`captured ${item.name}`);
}

async function prepareRequest(item) {
  const headers = { ...(item.request.headers ?? {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const pathResult = substitutePlaceholders(item.request.path);
  if (!pathResult.ok) return pathResult;

  if (item.transport === "multipart-upload") {
    const form = new FormData();
    for (const [name, relativePath] of Object.entries(
      item.request.multipartFields ?? {},
    )) {
      const filePath = path.resolve(fixtureDir, relativePath);
      const bytes = await readFile(filePath);
      form.append(
        name,
        new Blob([bytes], { type: "text/plain" }),
        path.basename(filePath),
      );
    }
    return { ok: true, path: pathResult.value, headers, body: form };
  }

  if (item.request.body !== undefined) {
    headers["Content-Type"] = "application/json";
    const substituted = substituteValue(item.request.body);
    if (!substituted.ok) return substituted;
    return {
      ok: true,
      path: pathResult.value,
      headers,
      body: JSON.stringify(substituted.value),
    };
  }

  return { ok: true, path: pathResult.value, headers, body: undefined };
}

function parseSse(text) {
  return text
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (data === "[DONE]") return { payloadType: "done" };
      try {
        const payload = JSON.parse(data);
        return {
          payloadType:
            payload && typeof payload.type === "string"
              ? payload.type
              : "message",
        };
      } catch {
        return { payloadType: "message" };
      }
    });
}

function defaultPayloadSchemas(transport) {
  if (transport !== "sse") return undefined;
  return {
    chat_id: { type: "string" },
    content_delta: { type: "string", text: "string" },
    citations: { type: "string", citations: "array" },
    cell_update: { type: "string", document_id: "string", status: "string" },
  };
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      /token|secret|key|authorization/i.test(key) ? "<redacted>" : redact(nested),
    ]),
  );
}

function substitutePlaceholders(value) {
  const missing = new Set();
  const next = value.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_m, name) => {
    const envName = `FIXTURE_${name}`;
    const envValue = process.env[envName];
    if (!envValue) {
      missing.add(envName);
      return "";
    }
    return envValue;
  });
  if (missing.size) {
    return {
      ok: false,
      error: `missing env ${Array.from(missing).join(", ")}`,
    };
  }
  return { ok: true, value: next };
}

function substituteValue(value) {
  if (typeof value === "string") {
    return substitutePlaceholders(value);
  }
  if (Array.isArray(value)) {
    const next = [];
    for (const nested of value) {
      const substituted = substituteValue(nested);
      if (!substituted.ok) return substituted;
      next.push(substituted.value);
    }
    return { ok: true, value: next };
  }
  if (!value || typeof value !== "object") return { ok: true, value };
  const next = {};
  for (const [key, nested] of Object.entries(value)) {
    const substituted = substituteValue(nested);
    if (!substituted.ok) return substituted;
    next[key] = substituted.value;
  }
  return { ok: true, value: next };
}
