import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir =
  process.env.FIXTURE_DIR ?? path.resolve(here, "..", "fixtures");
const apiBase = process.env.API_BASE ?? "http://localhost:3001";
const authToken = process.env.AUTH_TOKEN ?? "";

const files = (await readdir(fixtureDir))
  .filter((name) => name.endsWith(".json"))
  .sort();

let failures = 0;
for (const file of files) {
  const fixture = JSON.parse(
    await readFile(path.join(fixtureDir, file), "utf8"),
  );
  const result = await replayFixture(fixture);
  if (!result.ok) {
    failures += 1;
    console.error(`${file}: ${result.error}`);
  } else {
    console.log(`${file}: ok`);
  }
}

if (failures > 0) process.exit(1);

async function replayFixture(fixture) {
  const headers = { ...(fixture.request.headers ?? {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const pathWithVars = substitutePlaceholders(fixture.request.path);
  if (!pathWithVars.ok) return pathWithVars;

  const bodyResult = await buildBody(fixture, headers);
  if (!bodyResult.ok) return bodyResult;

  const response = await fetch(`${apiBase}${pathWithVars.value}`, {
    method: fixture.request.method,
    headers,
    body: bodyResult.body,
  });

  if (response.status !== fixture.response.status) {
    return {
      ok: false,
      error: `status ${response.status}, expected ${fixture.response.status}`,
    };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes(fixture.response.contentTypeIncludes)) {
    return {
      ok: false,
      error: `content-type ${contentType}, expected ${fixture.response.contentTypeIncludes}`,
    };
  }

  if (fixture.transport === "sse") {
    const text = await response.text();
    const events = parseSse(text);
    const allowedEventNames = fixture.response.allowedEventNames ?? [];
    if (allowedEventNames.length > 0) {
      const unexpected = events.find(
        (event) => !allowedEventNames.includes(event.name),
      );
      if (unexpected) {
        return {
          ok: false,
          error: `unexpected SSE event name ${unexpected.name}`,
        };
      }
    }

    const payloadTypes = events.map((event) => event.payloadType);
    const required = fixture.response.requiredPayloadTypes ?? [];
    const order = containsOrdered(payloadTypes, required);
    if (!order.ok) {
      return {
        ok: false,
        error: `SSE payload order ${JSON.stringify(payloadTypes)}, expected ordered ${JSON.stringify(required)}`,
      };
    }

    for (const [type, schema] of Object.entries(
      fixture.response.payloadSchemas ?? {},
    )) {
      const event = events.find((candidate) => candidate.payloadType === type);
      if (!event) continue;
      const schemaResult = validateSchema(event.payload, schema);
      if (!schemaResult.ok) return schemaResult;
    }
    return { ok: true };
  }

  if (fixture.transport?.includes("download")) {
    await response.arrayBuffer();
    return { ok: true };
  }

  if (fixture.response.requiredFields?.length) {
    const json = await response.json();
    for (const field of fixture.response.requiredFields) {
      if (!hasPath(json, field)) {
        return { ok: false, error: `missing response field ${field}` };
      }
    }
  }

  return { ok: true };
}

async function buildBody(fixture, headers) {
  if (fixture.transport === "multipart-upload") {
    const fields = fixture.request.multipartFields ?? {};
    const form = new FormData();
    for (const [name, relativePath] of Object.entries(fields)) {
      const filePath = path.resolve(fixtureDir, relativePath);
      const bytes = await readFile(filePath);
      form.append(
        name,
        new Blob([bytes], { type: "text/plain" }),
        path.basename(filePath),
      );
    }
    return { ok: true, body: form };
  }

  if (fixture.request.body !== undefined) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    const substituted = substituteValue(fixture.request.body);
    if (!substituted.ok) return substituted;
    return {
      ok: true,
      body: JSON.stringify(substituted.value),
    };
  }

  return { ok: true, body: undefined };
}

function parseSse(text) {
  return text
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      let name = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) name = line.slice(6).trim();
        if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (data === "[DONE]") {
        return { name, payloadType: "done", payload: null };
      }
      try {
        const payload = JSON.parse(data);
        return {
          name,
          payloadType:
            payload && typeof payload.type === "string"
              ? payload.type
              : "message",
          payload,
        };
      } catch {
        return { name, payloadType: "message", payload: data };
      }
    });
}

function containsOrdered(actual, required) {
  let offset = 0;
  for (const item of actual) {
    if (item === required[offset]) offset += 1;
    if (offset === required.length) return { ok: true };
  }
  return { ok: required.length === 0 };
}

function validateSchema(value, schema) {
  for (const [field, expectedType] of Object.entries(schema)) {
    const actual = getPath(value, field);
    if (expectedType === "array") {
      if (!Array.isArray(actual)) {
        return { ok: false, error: `${field} is not array` };
      }
    } else if (typeof actual !== expectedType) {
      return {
        ok: false,
        error: `${field} is ${typeof actual}, expected ${expectedType}`,
      };
    }
  }
  return { ok: true };
}

function hasPath(value, dottedPath) {
  return getPath(value, dottedPath) !== undefined;
}

function getPath(value, dottedPath) {
  let current = value;
  for (const part of dottedPath.split(".")) {
    if (current == null || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
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
