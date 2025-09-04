// hooks/useStreamingAI.ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Msg = { role: "system" | "user" | "assistant"; content: string };

type UseStreamingAIOptions = {
    endpoint?: string; // default: "/api/chat"
    debug?: boolean;
    /** Called right before the first delta arrives (good time to create an empty assistant turn) */
    onAssistantStart?: () => void;
    /** Called for each text delta chunk */
    onAssistantDelta?: (text: string) => void;
    /** Called after the stream finishes (success or error) */
    onAssistantDone?: () => void;
    /** Called when fetch/stream errors */
    onError?: (err: unknown) => void;
};

export function useStreamingAI(opts: UseStreamingAIOptions = {}) {
    const {
        endpoint = "/api/chat",
        debug = false,
        onAssistantStart,
        onAssistantDelta,
        onAssistantDone,
        onError,
    } = opts;

    const [isAnswering, setIsAnswering] = useState(false);
    const controllerRef = useRef<AbortController | null>(null);

    const extractText = (payload: string): string => {
        try {
            const evt = JSON.parse(payload);
            const delta: string =
                (evt?.delta ??
                    evt?.textDelta ??
                    evt?.value ??
                    evt?.content ??
                    (evt?.data && (evt.data.delta || evt.data.textDelta))) ||
                "";
            if (typeof delta === "string" && delta) return delta;
        } catch {
            /* not JSON */
        }

        // common SSE formats: `42: "text"` or just quoted "text"
        const mIdx = payload.match(/^\d+:\s*("([\s\S]*)")$/);
        if (mIdx && mIdx[1]) {
            try {
                return JSON.parse(mIdx[1]);
            } catch {
                return mIdx[1].slice(1, -1);
            }
        }
        const quoted = payload.match(/^"([\s\S]*)"$/);
        if (quoted) {
            try {
                return JSON.parse(payload);
            } catch {
                return quoted[1];
            }
        }

        // fallback to plain-text lines
        if (/^[\w"“”‘’().,:;!?%\-–—\s]+$/.test(payload)) return payload;

        return "";
    };

    const abort = useCallback(() => {
        controllerRef.current?.abort();
        controllerRef.current = null;
        setIsAnswering(false);
    }, []);

    const stream = useCallback(
        async (messages: Msg[]) => {
            if (isAnswering) return;
            setIsAnswering(true);
            const controller = new AbortController();
            controllerRef.current = controller;

            try {
                const res = await fetch(endpoint, {
                    method: "POST",
                    body: JSON.stringify({ messages }),
                    headers: { "Content-Type": "application/json" },
                    signal: controller.signal,
                });

                if (!res.ok || !res.body) {
                    throw new Error(`Bad response: ${res.status}`);
                }

                onAssistantStart?.();

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buf = "";

                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });

                    let nlIdx: number;
                    // process line-by-line
                    while ((nlIdx = buf.search(/\r?\n/)) >= 0) {
                        const rawLine = buf.slice(0, nlIdx);
                        buf = buf.slice(nlIdx + (buf[nlIdx] === "\r" && buf[nlIdx + 1] === "\n" ? 2 : 1));

                        let line = rawLine.trim();
                        if (!line) continue;
                        if (line.startsWith("data:")) line = line.slice(5).trim();
                        if (!line || line === "[DONE]") continue;

                        const text = extractText(line);
                        if (text) onAssistantDelta?.(text);
                    }
                }

                const tail = buf.trim();
                if (tail && tail !== "[DONE]") {
                    const payload = tail.startsWith("data:") ? tail.slice(5).trim() : tail;
                    const text = extractText(payload);
                    if (text) onAssistantDelta?.(text);
                }
            } catch (err) {
                if (debug) console.error("useStreamingAI error:", err);
                onError?.(err);
            } finally {
                setIsAnswering(false);
                controllerRef.current = null;
                onAssistantDone?.();
            }
        },
        [endpoint, extractText, isAnswering, onAssistantDelta, onAssistantDone, onAssistantStart, onError, debug]
    );

    // cleanup on unmount
    useEffect(() => abort, [abort]);

    return { isAnswering, stream, abort };
}
