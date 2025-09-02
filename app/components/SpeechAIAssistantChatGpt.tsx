"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, MessageSquare, Trash2, Send } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

const hasSpeechAPI =
    (typeof window !== "undefined" && !!(window as any).SpeechRecognition) ||
    !!(typeof window !== "undefined" && (window as any).webkitSpeechRecognition);

const newRecognizer = (): SpeechRecognition | null => {
    if (!hasSpeechAPI) return null;
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec: SpeechRecognition = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = "en-IN";
    return rec;
};

const endsWithQuestion = (text: string): boolean => {
    const t = text.trim();
    if (!t) return false;
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

    // NEW: small de-dupe buffer of recently finalized utterances
    const recentFinalsRef = useRef<string[]>([]); // store normalized strings

    const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

    // ✅ High: browser-safe timer type
    const finalizationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const PAUSE_DELAY = 1500; // ms of silence before treating as "final word/phrase"

    const isDuplicateFinal = (s: string) => {
        const key = normalize(s);
        const hit = recentFinalsRef.current.includes(key);
        if (!hit) {
            recentFinalsRef.current.push(key);
            if (recentFinalsRef.current.length > 20) recentFinalsRef.current.shift();
        }
        return hit;
    };

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

    /* ================== Start / Stop Mic ================== */
    const startListening = useCallback(() => {
        if (!hasSpeechAPI) {
            alert("Web Speech API is not supported in this browser.");
            return;
        }
        if (isListening) return; // guard against double starts

        const rec = ensureRecognizer();
        if (!rec) return;

        rec.onresult = (ev: SpeechRecognitionEvent) => {
            let interim = "";
            let finalChunk = "";

            for (let i = ev.resultIndex; i < ev.results.length; i++) {
                const result = ev.results[i];
                const alt = result[0];
                if (!alt) continue;
                if (result.isFinal) {
                    finalChunk += alt.transcript;
                } else {
                    interim += alt.transcript;
                }

                if (process.env.NODE_ENV !== "production") {
                    console.log(finalChunk, "finalChunk");
                    console.log(interim, "interim");
                }
            }

            setInterimText(interim || "");

            if (finalChunk) {
                const clean = finalChunk.trim();
                if (!clean) return;

                // clear previous timer
                if (finalizationTimerRef.current) clearTimeout(finalizationTimerRef.current);

                // wait extra pause before committing final
                finalizationTimerRef.current = setTimeout(() => {
                    if (isDuplicateFinal(clean)) return;

                    // push the user message once here
                    setTranscript((prev) => [...prev, { role: "user", content: clean, ts: now() }]);

                    // Build complete text FIRST
                    const completeText = pendingFinalUser ? `${pendingFinalUser.trim()} ${clean}`.trim() : clean;
                    setPendingFinalUser(completeText);

                    if (endsWithQuestion(completeText)) {
                        void answerNow(completeText, true); // skipPush=true so we won't double-count
                    }
                }, PAUSE_DELAY);
            }
        };

        rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
            if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
                keepAliveRef.current = false;
                setIsListening(false);
                console.error("Speech permission error:", (ev as any).message);
            } else {
                console.warn("Speech error:", ev.error, (ev as any).message);
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
    }, [ensureRecognizer, isListening, pendingFinalUser]);

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
            if (finalizationTimerRef.current) clearTimeout(finalizationTimerRef.current);
        };
    }, [stopListening]);

    /* ================== SSE Client for /api/chat ================== */
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

                const parseQuoted = (s: string): string | null => {
                    const m = s.match(/^"([\s\S]*)"$/);
                    if (!m) return null;
                    try {
                        return JSON.parse(s);
                    } catch {
                        return m[1];
                    }
                };

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
                        /* not JSON; continue */
                    }

                    const mIdx = payload.match(/^\d+:\s*("([\s\S]*)")$/);
                    if (mIdx && mIdx[1]) {
                        const s = parseQuoted(mIdx[1]);
                        if (s) return s;
                    }

                    const q = parseQuoted(payload);
                    if (q) return q;

                    if (/^[fed]:\s*\{/.test(payload)) return "";

                    if (/^[\w"“”‘’().,:;!?%\-–—\s]+$/.test(payload)) {
                        return payload;
                    }

                    return "";
                };

                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });

                    let nlIdx: number;
                    while ((nlIdx = buf.search(/\r?\n/)) >= 0) {
                        const line = buf.slice(0, nlIdx);
                        buf = buf.slice(nlIdx + (buf[nlIdx] === "\r" && buf[nlIdx + 1] === "\n" ? 2 : 1));

                        let raw = line.trim();
                        if (!raw) continue;
                        if (raw.startsWith("data:")) raw = raw.slice(5).trim();
                        if (!raw || raw === "[DONE]") continue;

                        const text = extractText(raw);
                        if (text) append(text);
                    }
                }

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

    if (process.env.NODE_ENV !== "production") console.log(transcript, "transcript");

    /* ================== Answer Now (manual or auto) ================== */
    // skipPush: if true, do NOT add a user turn (used when we already pushed in onresult)
    const answerNow = useCallback(
        async (textOverride?: string, skipPush = false) => {
            if (isAnswering) return;

            const snapshotInterim = interimText.trim();
            let userText = textOverride?.trim() || pendingFinalUser.trim();

            if (!textOverride && snapshotInterim) {
                userText = userText ? `${userText} ${snapshotInterim}` : snapshotInterim;
            }
            if (!userText) return;

            if (!skipPush) {
                // Manual trigger: push the user turn now
                setTranscript((prev) => [...prev, { role: "user", content: userText, ts: now() }]);
            }

            setInterimText("");
            setPendingFinalUser("");

            const MAX_TURNS = 12;
            const base = transcript.filter((m) => m.role !== "system");
            const recent = base.slice(-MAX_TURNS);

            // ✅ High: avoid duplicating the latest user content in messagesForAI when auto mode already pushed it
            const messagesForAI = [
                { role: "system" as const, content: SYSTEM_PROMPT },
                ...recent.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
                ...(!skipPush ? ([{ role: "user" as const, content: userText }] as const) : []),
            ];

            if (process.env.NODE_ENV !== "production") console.log("Messages for AI:", messagesForAI);

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
        recentFinalsRef.current = [];
    }, []);

    const cleanTranscript = useMemo(() => transcript.filter((t) => t.role !== "system"), [transcript]);

    /* ================== UI (Transcript on top, controls at bottom) ================== */
    return (
        <Card className="w-full max-w-2xl mx-auto">
            <CardHeader className="flex items-center justify-between space-y-0">
                <div className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5" />
                    <CardTitle>Speech AI Assistant</CardTitle>
                </div>
                <Badge variant="secondary">{isListening ? "Listening…" : "Idle"}</Badge>
            </CardHeader>

            <CardContent className="flex flex-col gap-4 h-[calc(100vh-12rem)] overflow-y-auto">
                {/* Transcript window (TOP) */}
                <div ref={scrollBoxRef} className="border rounded-md p-3 flex-1 overflow-y-auto space-y-3 bg-muted/20">
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

                                <div className="prose prose-sm max-w-none dark:prose-invert">
                                    {/* ✅ High: sanitize markdown */}
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{t.content}</ReactMarkdown>
                                </div>
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

                {/* Sticky footer (BOTTOM): interim + controls */}
                <div className="sticky bottom-0 bg-background/80 backdrop-blur rounded-md border p-3 space-y-3">
                    {/* Interim speech preview */}
                    <div className="text-sm text-muted-foreground min-h-5">
                        {isListening && interimText ? <em>Speaking: “{interimText}”</em> : null}
                    </div>

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

                    {!hasSpeechAPI && (
                        <div className="text-xs text-destructive">
                            This browser doesn’t support the Web Speech API. Try Chrome or Edge (desktop).
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
