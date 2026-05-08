import type { StreamChatParams, StreamChatResult } from "./types";

export function mockProviderEnabled(): boolean {
    return process.env.LUKE_MOCK_LLM === "1";
}

export async function streamMockChat(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    const firstTool = params.tools?.[0]?.function.name;

    params.callbacks?.onReasoningDelta?.("mock reasoning");
    params.callbacks?.onReasoningBlockEnd?.();

    if (firstTool && params.runTools) {
        const call = {
            id: "mock-tool-call-1",
            name: firstTool,
            input: mockToolInput(firstTool),
        };
        params.callbacks?.onToolCallStart?.(call);
        await params.runTools([call]);
    }

    const fullText =
        "Mock provider response.\n\n<CITATIONS>[]</CITATIONS>";
    params.callbacks?.onContentDelta?.(fullText);
    return { fullText };
}

export async function completeMockText(params: {
    user: string;
}): Promise<string> {
    const lower = params.user.toLowerCase();
    if (lower.includes("column title:")) {
        return JSON.stringify({
            prompt: "Extract the requested value from the document.",
        });
    }
    if (lower.includes("generate a concise title")) {
        return "Mock Chat Title";
    }
    return "Mock completion";
}

function mockToolInput(name: string): Record<string, unknown> {
    if (name === "read_document") return { doc_id: "doc-0" };
    if (name === "fetch_documents") return { doc_ids: ["doc-0"] };
    if (name === "find_in_document") return { doc_id: "doc-0", query: "mock" };
    if (name === "read_workflow") return { workflow_id: "mock-workflow" };
    if (name === "read_table_cells") return {};
    return {};
}
