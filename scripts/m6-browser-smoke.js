const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const appBase = process.env.LUKE_SMOKE_FRONTEND ?? "http://localhost:3000";
const apiBase = process.env.LUKE_SMOKE_API ?? "http://127.0.0.1:3001";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  try {
    await page.goto(`${appBase}/projects`, { waitUntil: "networkidle" });
    assert.match(await page.locator("body").innerText(), /Projects|No projects|New Project/i);

    const result = await page.evaluate(async ({ apiBase }) => {
      async function json(path, options = {}) {
        const response = await fetch(`${apiBase}${path}`, {
          ...options,
          headers: {
            ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
            ...(options.headers ?? {}),
          },
        });
        const text = await response.text();
        if (!response.ok) {
          throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status}: ${text}`);
        }
        return text ? JSON.parse(text) : null;
      }

      async function sse(path, body) {
        const response = await fetch(`${apiBase}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok || !response.body) {
          throw new Error(`SSE ${path} -> ${response.status}: ${await response.text()}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const events = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            events.push(JSON.parse(data));
          }
        }
        return events;
      }

      const unique = `m6-browser-${Date.now()}`;
      const project = await json("/projects", {
        method: "POST",
        body: JSON.stringify({ name: `M6 Browser Smoke ${unique}` }),
      });
      const projectId = String(project.id).split(":").pop();

      const formData = new FormData();
      formData.append(
        "file",
        new File([
          "M6 browser smoke document. The borrower requests a concise credit summary.",
        ], `${unique}.txt`, { type: "text/plain" }),
      );
      const document = await json(`/projects/${projectId}/documents`, {
        method: "POST",
        body: formData,
      });
      const documentId = String(document.id).split(":").pop();

      const chatEvents = await sse(`/projects/${projectId}/chat`, {
        messages: [{ role: "user", content: "Summarize the uploaded document." }],
        document_ids: [documentId],
      });
      const chatId = chatEvents.find((event) => event.type === "chat_id")?.chat_id;
      if (!chatId) throw new Error("project chat stream did not return chat_id");

      const workflow = await json("/workflows", {
        method: "POST",
        body: JSON.stringify({
          title: `M6 Tabular Flow ${unique}`,
          type: "tabular",
          columns_config: [{ index: 0, name: "Summary", prompt: "Summarize the document" }],
        }),
      });
      const workflowId = String(workflow.id).split(":").pop();

      const review = await json("/tabular-review", {
        method: "POST",
        body: JSON.stringify({
          project_id: projectId,
          title: `M6 Browser Review ${unique}`,
          workflow_id: workflowId,
          document_ids: [documentId],
          columns_config: [{ index: 0, name: "Summary", prompt: "Summarize the document" }],
        }),
      });
      const reviewId = String(review.id).split(":").pop();

      const tabularEvents = await sse(`/tabular-review/${reviewId}/generate`, {
        document_ids: [documentId],
        column_indices: [0],
      });
      const cellEvent = tabularEvents.find((event) => event.type === "cell_update");
      if (!cellEvent?.content || cellEvent.column_index !== 0) {
        throw new Error(`tabular stream did not emit consumable cell_update: ${JSON.stringify(tabularEvents)}`);
      }

      const persistedProject = await json(`/projects/${projectId}`);
      const persistedDocs = await json(`/projects/${projectId}/documents`);
      const persistedChat = await json(`/chat/${chatId}`);
      const persistedReview = await json(`/tabular-review/${reviewId}`);

      return {
        projectId,
        documentId,
        chatId,
        workflowId,
        reviewId,
        chatEventTypes: chatEvents.map((event) => event.type),
        tabularEventTypes: tabularEvents.map((event) => event.type),
        projectName: persistedProject.name,
        documentCount: persistedDocs.length,
        messageCount: persistedChat.messages.length,
        cellCount: persistedReview.cells.length,
      };
    }, { apiBase });

    assert.ok(result.documentCount >= 1, "document persisted");
    assert.ok(result.messageCount >= 2, "chat messages persisted");
    assert.ok(result.cellCount >= 1, "tabular cell persisted");
    assert.ok(result.chatEventTypes.includes("chat_id"), "chat stream produced chat_id");
    assert.ok(result.chatEventTypes.includes("done"), "chat stream completed");
    assert.ok(result.tabularEventTypes.includes("cell_update"), "tabular stream produced cell_update");
    assert.ok(result.tabularEventTypes.includes("done"), "tabular stream completed");

    await page.goto(`${appBase}/projects/${result.projectId}`, { waitUntil: "networkidle" });
    assert.match(await page.locator("body").innerText(), /M6 Browser Smoke/);
    await page.reload({ waitUntil: "networkidle" });
    assert.match(await page.locator("body").innerText(), /M6 Browser Smoke/);

    await page.goto(`${appBase}/projects/${result.projectId}/tabular-reviews/${result.reviewId}`, { waitUntil: "networkidle" });
    assert.match(await page.locator("body").innerText(), /Summary|M6 Browser Review/);

    console.log(JSON.stringify(result, null, 2));
    const relevantErrors = consoleErrors.filter((line) => {
      return !line.includes("favicon") && !line.includes("ERR_INVALID_HTTP_RESPONSE");
    });
    assert.deepEqual(relevantErrors, []);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
