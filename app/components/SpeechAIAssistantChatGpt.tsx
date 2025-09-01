"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, MessageSquare, Trash2, Send } from "lucide-react";

/* ====================== Web Speech API Types (TS-safe) ====================== */
interface SpeechGrammarList {
    addFromString(src: string, weight?: number): void;
    addFromURI(src: string, weight?: number): void;
}
interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
    readonly error:
        | "no-speech"
        | "aborted"
        | "audio-capture"
        | "network"
        | "not-allowed"
        | "service-not-allowed"
        | "bad-grammar"
        | "language-not-supported";
    readonly message: string;
}
interface SpeechRecognitionAlternative {
    readonly confidence: number;
    readonly transcript: string;
}
interface SpeechRecognitionResult {
    readonly isFinal: boolean;
    readonly length: number;
    item(index: number): SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
    readonly length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognition extends EventTarget {
    grammars: SpeechGrammarList;
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    serviceURI: string;
    start(): void;
    stop(): void;
    abort(): void;
    onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
    onend: ((this: SpeechRecognition, ev: Event) => any) | null;
    onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
    onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
    onnomatch: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
}



/* ============================ Types & Helpers ============================ */
type Role = "system" | "user" | "assistant";
interface ChatTurn {
    role: Role;
    content: string;
    ts: number;
}

const SYSTEM_PROMPT = "Helpful AI tech assistant, concise, correct Indian English errors.";

const hasSpeechAPI = typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

const newRecognizer = (): SpeechRecognition | null => {
    if (!hasSpeechAPI) return null;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec: SpeechRecognition = new (Ctor as any)();
    rec.continuous = true; // keep listening
    rec.interimResults = true; // partial results while speaking
    rec.maxAlternatives = 1;
    rec.lang = "en-IN"; // Indian English
    return rec;
};

const endsWithQuestion = (text: string): boolean => {
    const t = text.trim();
    if (!t) return false;
    if (/[?？！]$/.test(t)) return true;
    const first = t.split(/\s+/)[0]?.toLowerCase();
    return (
        new Set([
            "what",
            "why",
            "how",
            "when",
            "where",
            "which",
            "who",
            "whom",
            "whose",
            "can",
            "could",
            "should",
            "would",
            "is",
            "are",
            "do",
            "does",
            "did",
            "will",
            "may",
            "might",
        ]).has(first) && t.length > 10
    );
};

const now = () => Date.now();

/* ============================ Component ============================ */
export default function SpeechAIAssistant() {
    const [isListening, setIsListening] = useState(false);
    const [isAnswering, setIsAnswering] = useState(false);
    const [typingDots, setTypingDots] = useState(".");

    const [transcript, setTranscript] = useState<ChatTurn[]>([{ role: "system", content: SYSTEM_PROMPT, ts: now() }]);

    const [interimText, setInterimText] = useState<string>("");
    const [pendingFinalUser, setPendingFinalUser] = useState<string>("");

    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const keepAliveRef = useRef<boolean>(false);
    const aiAbortRef = useRef<AbortController | null>(null);
    const scrollBoxRef = useRef<HTMLDivElement | null>(null);
    const assistantIndexRef = useRef<number>(-1);

    /* Typing dots while streaming */
    useEffect(() => {
        if (!isAnswering) return;
        let i = 0;
        const id = setInterval(() => {
            i = (i + 1) % 3;
            setTypingDots(".".repeat(i + 1));
        }, 450);
        return () => clearInterval(id);
    }, [isAnswering]);

    /* Auto-scroll transcript */
    const scrollToBottom = useCallback(() => {
        const el = scrollBoxRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [transcript, interimText, isAnswering, scrollToBottom]);

    /* Ensure recognizer instance */
    const ensureRecognizer = useCallback(() => {
        if (!recognitionRef.current) recognitionRef.current = newRecognizer();
        return recognitionRef.current;
    }, []);

    /* Start continuous listening */
    const startListening = useCallback(() => {
        if (!hasSpeechAPI) {
            alert("Web Speech API is not supported in this browser.");
            return;
        }
        const rec = ensureRecognizer();
        if (!rec) return;

        rec.onresult = (ev: SpeechRecognitionEvent) => {
            let interim = "";
            let finalChunk = "";

            for (let i = ev.resultIndex; i < ev.results.length; i++) {
                const res = ev.results[i];
                const alt = res[0];
                if (!alt) continue;
                if (res.isFinal) finalChunk += alt.transcript;
                else interim += alt.transcript;
            }

            setInterimText(interim || "");

            if (finalChunk) {
                const clean = finalChunk.trim();
                if (!clean) return;

                // Show finalized piece as a user turn
                setTranscript((prev) => [...prev, { role: "user", content: clean, ts: now() }]);

                // Buffer for combined prompt
                setPendingFinalUser((prev) => (prev ? `${prev.trim()} ${clean}`.trim() : clean));

                // Auto-answer when we detect a question; pass exact text to avoid state races
                if (endsWithQuestion(clean)) {
                    void answerNow(clean);
                }
            }
        };

        rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
            if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
                keepAliveRef.current = false;
                setIsListening(false);
                console.error("Speech permission error:", ev.message);
            } else {
                console.warn("Speech error:", ev.error, ev.message);
            }
        };

        rec.onend = () => {
            // Auto-restart to stay continuous
            if (keepAliveRef.current) {
                try {
                    rec.start();
                } catch {
                    setTimeout(() => {
                        try {
                            rec.start();
                        } catch (e) {
                            console.error("Failed to restart recognition:", e);
                        }
                    }, 200);
                }
            }
        };

        try {
            keepAliveRef.current = true;
            rec.start();
            setIsListening(true);
        } catch (e) {
            console.error("Failed to start recognition:", e);
            keepAliveRef.current = false;
            setIsListening(false);
        }
    }, [ensureRecognizer]);

    /* Stop listening (soft stop by default) */
    const stopListening = useCallback((hardAbort = false) => {
        const rec = recognitionRef.current;
        keepAliveRef.current = false;
        setIsListening(false);
        if (!rec) return;
        try {
            if (hardAbort) rec.abort();
            else rec.stop();
        } catch (e) {
            console.error("Failed to stop recognition:", e);
        }
    }, []);

    /* On unmount, clean up */
    useEffect(() => {
        return () => {
            stopListening(true);
            aiAbortRef.current?.abort();
        };
    }, [stopListening]);

    /* ================== SSE Client for /api/chat (robust across chat streams) ================== */
    const streamAI = useCallback(
        async (messagesForAI: Array<{ role: "system" | "user" | "assistant"; content: string }>) => {
            setIsAnswering(true);
            const controller = new AbortController();
            aiAbortRef.current = controller;

            try {
                const res = await fetch("/api/chat", {
                    method: "POST",
                    body: JSON.stringify({ messages: messagesForAI }),
                    headers: { "Content-Type": "application/json" },
                    signal: controller.signal,
                });

                if (!res.ok || !res.body) {
                    console.error("[/api/chat] bad response:", res.status);
                    throw new Error(`Bad response: ${res.status}`);
                }

                // Create an empty assistant message to stream into
                setTranscript((prev) => {
                    const idx = prev.length;
                    assistantIndexRef.current = idx;
                    return [...prev, { role: "assistant", content: "", ts: now() }];
                });

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buf = "";

                const append = (text: string) => {
                    if (!text) return;
                    setTranscript((prev) => {
                        const idx =
                            assistantIndexRef.current >= 0
                                ? assistantIndexRef.current
                                : Math.max(
                                      0,
                                      prev.map((p, i) => (p.role === "assistant" ? i : -1)).pop() ?? prev.length - 1
                                  );
                        const draft = [...prev];
                        draft[idx] = { ...draft[idx], content: draft[idx].content + text };
                        return draft;
                    });
                };

                // Parse a quoted string payload and unescape via JSON
                const parseQuoted = (s: string): string | null => {
                    const m = s.match(/^"([\s\S]*)"$/);
                    if (!m) return null;
                    try {
                        return JSON.parse(s); // proper unescaping
                    } catch {
                        return m[1]; // fallback raw inner text
                    }
                };

                // Extract text from various payload shapes (covers "all chats")
                const extractText = (payload: string): string => {
                    // 1) Try JSON (Vercel AI SDK / other JSON-emitting servers)
                    try {
                        const evt = JSON.parse(payload);
                        const delta: string =
                            evt?.delta ??
                            evt?.textDelta ??
                            evt?.value ??
                            evt?.content ??
                            (evt?.data && (evt.data.delta || evt.data.textDelta)) ??
                            "";
                        if (typeof delta === "string" && delta) return delta;
                    } catch {
                        /* not JSON; continue */
                    }

                    // 2) index-prefixed chunk: 0:"Hi"
                    const mIdx = payload.match(/^\d+:\s*("([\s\S]*)")$/);
                    if (mIdx && mIdx[1]) {
                        const s = parseQuoted(mIdx[1]);
                        if (s) return s;
                    }

                    // 3) plain quoted string: "Hello world"
                    const q = parseQuoted(payload);
                    if (q) return q;

                    // 4) metadata frames like f:{…}, e:{…}, d:{…} → ignore
                    if (/^[fed]:\s*\{/.test(payload)) return "";

                    // 5) Some servers send bare text without quotes. As a last resort, pass it through
                    // ONLY if it looks like normal words (avoid dumping JSON-ish blobs).
                    if (/^[\w"“”‘’().,:;!?%\-–—\s]+$/.test(payload)) {
                        return payload;
                    }

                    return "";
                };

                // Read stream; accept lines with or without `data:` prefix
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });

                    // Process full lines; leave any partial line in buf
                    let nlIdx: number;
                    while ((nlIdx = buf.search(/\r?\n/)) >= 0) {
                        const line = buf.slice(0, nlIdx);
                        buf = buf.slice(nlIdx + (buf[nlIdx] === "\r" && buf[nlIdx + 1] === "\n" ? 2 : 1));

                        let raw = line.trim();
                        if (!raw) continue;

                        // Accept both "data: ..." AND raw payload lines
                        if (raw.startsWith("data:")) raw = raw.slice(5).trim();

                        if (!raw || raw === "[DONE]") continue;

                        const text = extractText(raw);
                        if (text) append(text);
                    }
                }

                // Flush any remaining buffered line (if server ended without newline)
                const tail = buf.trim();
                if (tail) {
                    const payload = tail.startsWith("data:") ? tail.slice(5).trim() : tail;
                    if (payload && payload !== "[DONE]") {
                        const text = extractText(payload);
                        if (text) append(text);
                    }
                }
            } finally {
                setIsAnswering(false);
                aiAbortRef.current = null;
            }
        },
        []
    );

    /* ================== Answer Now (manual or auto) ================== */
    const answerNow = useCallback(
        async (textOverride?: string) => {
            if (isAnswering) return;

            const snapshotInterim = interimText.trim();
            let userText = textOverride?.trim() || pendingFinalUser.trim();

            // If clicking Answer Now mid-utterance, commit interim too
            if (!textOverride && snapshotInterim) {
                userText = userText ? `${userText} ${snapshotInterim}` : snapshotInterim;
            }
            if (!userText) return;

            // Show user turn immediately
            setTranscript((prev) => [...prev, { role: "user", content: userText, ts: now() }]);

            // Reset buffers
            setInterimText("");
            setPendingFinalUser("");

            // Compact context (synchronous snapshot)
            const MAX_TURNS = 12;
            const base = transcript.filter((m) => m.role !== "system");
            const recent = base.slice(-MAX_TURNS);
            const messagesForAI = [
                { role: "system" as const, content: SYSTEM_PROMPT },
                ...recent.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
                { role: "user" as const, content: userText },
            ];

            await streamAI(messagesForAI);
        },
        [interimText, isAnswering, pendingFinalUser, transcript, streamAI]
    );

    /* ================== Clear All ================== */
    const clearAll = useCallback(() => {
        aiAbortRef.current?.abort();
        setTranscript([{ role: "system", content: SYSTEM_PROMPT, ts: now() }]);
        setInterimText("");
        setPendingFinalUser("");
    }, []);

    const cleanTranscript = useMemo(() => transcript.filter((t) => t.role !== "system"), [transcript]);

    /* ================== UI ================== */
    return (
        <Card className="w-full max-w-2xl mx-auto">
            <CardHeader className="flex items-center justify-between space-y-0">
                <div className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5" />
                    <CardTitle>Speech AI Assistant</CardTitle>
                </div>
                <Badge variant="secondary">{isListening ? "Listening…" : "Idle"}</Badge>
            </CardHeader>

            <CardContent className="space-y-4">
                {/* Controls */}
                <div className="flex flex-wrap gap-2">
                    {!isListening ? (
                        <Button onClick={startListening} size="sm">
                            <Mic className="h-4 w-4 mr-2" /> Start Mic
                        </Button>
                    ) : (
                        <Button onClick={() => stopListening()} size="sm" variant="destructive">
                            <MicOff className="h-4 w-4 mr-2" /> Stop Mic
                        </Button>
                    )}

                    <Button onClick={() => void answerNow()} size="sm" disabled={isAnswering}>
                        <Send className="h-4 w-4 mr-2" /> Answer Now
                    </Button>

                    <Button onClick={clearAll} size="sm" variant="secondary">
                        <Trash2 className="h-4 w-4 mr-2" /> Clear All
                    </Button>
                </div>

                {/* Interim speech preview */}
                <div className="text-sm text-muted-foreground min-h-5">
                    {isListening && interimText ? <em>Speaking: “{interimText}”</em> : null}
                </div>

                {/* Transcript window */}
                <div ref={scrollBoxRef} className="border rounded-md p-3 h-80 overflow-y-auto space-y-3 bg-muted/20">
                    {cleanTranscript.length === 0 && (
                        <div className="text-sm text-muted-foreground">
                            Start speaking… I’ll auto-answer when I hear a question. You can also click{" "}
                            <em>Answer Now</em>.
                        </div>
                    )}

                    {cleanTranscript.map((t, idx) => (
                        <div
                            key={t.ts + ":" + idx}
                            className={`flex ${t.role === "assistant" ? "justify-start" : "justify-end"}`}
                        >
                            <div
                                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                                    t.role === "assistant" ? "bg-white border" : "bg-primary text-primary-foreground"
                                }`}
                            >
                                <div className="text-[10px] opacity-60 mb-0.5">
                                    {t.role === "assistant" ? "Assistant" : "You"}
                                </div>
                                <div className="whitespace-pre-wrap">{t.content}</div>
                            </div>
                        </div>
                    ))}

                    {isAnswering && (
                        <div className="flex justify-start">
                            <div className="max-w-[85%] rounded-2xl px-3 py-2 text-sm bg-white border shadow-sm">
                                <div className="text-[10px] opacity-60 mb-0.5">Assistant</div>
                                <div>Thinking{typingDots}</div>
                            </div>
                        </div>
                    )}
                </div>

                {!hasSpeechAPI && (
                    <div className="text-xs text-destructive">
                        This browser doesn’t support the Web Speech API. Try Chrome or Edge (desktop).
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
