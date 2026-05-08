import type {
    NormalizedToolCall,
    StreamChatParams,
    StreamChatResult,
} from "./types";
import {
    completeMockText,
    mockProviderEnabled,
    streamMockChat,
} from "./mock";

type OllamaToolCall = {
    type?: "function";
    function?: {
        index?: number;
        name?: string;
        arguments?: Record<string, unknown>;
    };
};

type OllamaMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content?: string;
    thinking?: string;
    tool_calls?: OllamaToolCall[];
    tool_name?: string;
};

type OllamaChatChunk = {
    message?: {
        content?: string;
        thinking?: string;
        tool_calls?: OllamaToolCall[];
    };
    error?: string;
    done?: boolean;
};

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

function baseUrl(): string {
    return (process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL).replace(
        /\/+$/,
        "",
    );
}

function toNativeMessages(params: StreamChatParams): OllamaMessage[] {
    const systemPrompt = params.enableThinking
        ? `<|think|>\n${params.systemPrompt}`
        : params.systemPrompt;

    return [
        { role: "system", content: systemPrompt },
        ...params.messages.map((m) => ({
            role: m.role,
            content: m.content,
        })),
    ];
}

function normalizeToolCall(
    call: OllamaToolCall,
    index: number,
): NormalizedToolCall | null {
    const name = call.function?.name;
    if (!name) return null;
    return {
        id: `${name}-${call.function?.index ?? index}`,
        name,
        input: call.function?.arguments ?? {},
    };
}

async function postChat(body: Record<string, unknown>): Promise<Response> {
    const response = await fetch(`${baseUrl()}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
            `Ollama request failed (${response.status}): ${text || response.statusText}`,
        );
    }

    return response;
}

export async function streamOllama(
    params: StreamChatParams,
): Promise<StreamChatResult> {
    if (mockProviderEnabled()) return streamMockChat(params);

    const { model, tools = [], callbacks = {}, runTools, enableThinking } = params;
    const maxIter = params.maxIterations ?? 10;
    const messages = toNativeMessages(params);
    let fullText = "";

    for (let iter = 0; iter < maxIter; iter++) {
        const response = await postChat({
            model,
            messages,
            tools: tools.length ? tools : undefined,
            stream: true,
            think: !!enableThinking,
            options: {
                temperature: 1,
                top_p: 0.95,
                top_k: 64,
            },
        });

        if (!response.body) throw new Error("Ollama response body was empty");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let text = "";
        let thinking = "";
        const rawToolCalls: OllamaToolCall[] = [];

        const handleLine = (line: string) => {
            if (!line.trim()) return;
            const chunk = JSON.parse(line) as OllamaChatChunk;
            if (chunk.error) throw new Error(`Ollama error: ${chunk.error}`);

            const thoughtDelta = chunk.message?.thinking ?? "";
            if (thoughtDelta) {
                thinking += thoughtDelta;
                callbacks.onReasoningDelta?.(thoughtDelta);
            }

            const contentDelta = chunk.message?.content ?? "";
            if (contentDelta) {
                text += contentDelta;
                callbacks.onContentDelta?.(contentDelta);
            }

            for (const call of chunk.message?.tool_calls ?? []) {
                rawToolCalls.push(call);
            }
        };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let newlineIndex = buffer.indexOf("\n");
            while (newlineIndex >= 0) {
                const line = buffer.slice(0, newlineIndex);
                buffer = buffer.slice(newlineIndex + 1);
                handleLine(line);
                newlineIndex = buffer.indexOf("\n");
            }
        }
        buffer += decoder.decode();
        handleLine(buffer);

        if (thinking) callbacks.onReasoningBlockEnd?.();
        fullText += text;

        const toolCalls = rawToolCalls
            .map((call, i) => normalizeToolCall(call, i))
            .filter((call): call is NormalizedToolCall => !!call);

        messages.push({
            role: "assistant",
            content: text,
            ...(thinking ? { thinking } : {}),
            ...(rawToolCalls.length ? { tool_calls: rawToolCalls } : {}),
        });

        if (!toolCalls.length || !runTools) break;

        for (const call of toolCalls) callbacks.onToolCallStart?.(call);
        const results = await runTools(toolCalls);
        for (const result of results) {
            const match = toolCalls.find((c) => c.id === result.tool_use_id);
            messages.push({
                role: "tool",
                tool_name: match?.name ?? "tool",
                content: result.content,
            });
        }
    }

    return { fullText };
}

export async function completeOllamaText(params: {
    model: string;
    systemPrompt?: string;
    user: string;
}): Promise<string> {
    if (mockProviderEnabled()) return completeMockText(params);

    const response = await postChat({
        model: params.model,
        messages: [
            ...(params.systemPrompt
                ? [{ role: "system", content: params.systemPrompt }]
                : []),
            { role: "user", content: params.user },
        ],
        stream: false,
        options: {
            temperature: 1,
            top_p: 0.95,
            top_k: 64,
        },
    });
    const body = (await response.json()) as OllamaChatChunk;
    if (body.error) throw new Error(`Ollama error: ${body.error}`);
    return body.message?.content ?? "";
}
