import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(here, "..", "fixtures");
const apiBase = process.env.API_BASE ?? "http://localhost:3001";

const project = await postJSON("/projects", { name: "Fixture Project" });
const upload = await postMultipart(
  "/single-documents",
  "file",
  "sample.docx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
);
const documentId = trimRecord(upload.id);
const versionId = trimRecord(upload.current_version_id) || `${documentId}_v1`;
const review = await postJSON("/tabular-review", {
  title: "Fixture Review",
  project_id: trimRecord(project.id),
  document_ids: [documentId],
  columns_config: [{ index: 0, name: "Summary", prompt: "Summarize" }],
});

console.log(`export FIXTURE_projectId=${shellQuote(trimRecord(project.id))}`);
console.log(`export FIXTURE_documentId=${shellQuote(documentId)}`);
console.log(`export FIXTURE_versionId=${shellQuote(versionId)}`);
console.log(`export FIXTURE_reviewId=${shellQuote(trimRecord(review.id))}`);

async function postJSON(url, body) {
  const response = await fetch(`${apiBase}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJSON(response, url);
}

async function postMultipart(url, fieldName, filename, contentType) {
  const form = new FormData();
  const bytes = await readFile(path.join(fixtureDir, filename));
  form.append(fieldName, new Blob([bytes], { type: contentType }), filename);
  const response = await fetch(`${apiBase}${url}`, {
    method: "POST",
    body: form,
  });
  return readJSON(response, url);
}

async function readJSON(response, url) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

function trimRecord(value) {
  if (!value) return "";
  const text = String(value);
  return text.includes(":") ? text.split(":").at(-1) : text;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
