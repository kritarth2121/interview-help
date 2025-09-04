// app/components/SpeechAIAssistant.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, MessageSquare, Trash2, Send } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { useStreamingAI } from "../hooks/useStreamingAI";

/* ============================ Types & Helpers ============================ */
type Role = "system" | "user" | "assistant";
interface ChatTurn {
    role: Role;
    content: string;
    ts: number;
}
const now = () => Date.now();
const SYSTEM_PROMPT = "Helpful AI tech assistant, concise, correct Indian English errors.";

/* ============================ Component ============================ */
export default function SpeechAIAssistant() {
    const [typingDots, setTypingDots] = useState(".");
    const [transcript, setTranscript] = useState<ChatTurn[]>([{ role: "system", content: SYSTEM_PROMPT, ts: now() }]);

    const [interimTextLocal, setInterimTextLocal] = useState<string>(""); // for footer preview

    const scrollBoxRef = useRef<HTMLDivElement | null>(null);
    const assistantIndexRef = useRef<number>(-1);

    /* ========== Typing dots while streaming ========== */
    const { isAnswering, stream, abort } = useStreamingAI({
        onAssistantStart: () => {
            // Create an empty assistant turn and remember its index
            setTranscript((prev) => {
                const idx = prev.length;
                assistantIndexRef.current = idx;
                return [...prev, { role: "assistant", content: "", ts: now() }];
            });
        },
        onAssistantDelta: (text) => {
            setTranscript((prev) => {
                const idx =
                    assistantIndexRef.current >= 0
                        ? assistantIndexRef.current
                        : prev.findLastIndex((t) => t.role === "assistant");
                if (idx < 0) return prev;
                const draft = [...prev];
                draft[idx] = { ...draft[idx], content: draft[idx].content + text };
                return draft;
            });
        },
        onAssistantDone: () => {
            assistantIndexRef.current = -1;
        },
        onError: (e) => {
            console.error("Stream error:", e);
        },
        debug: process.env.NODE_ENV !== "production",
    });

    useEffect(() => {
        if (!isAnswering) return;
        let i = 0;
        const id = setInterval(() => {
            i = (i + 1) % 3;
            setTypingDots(".".repeat(i + 1));
        }, 450);
        return () => clearInterval(id);
    }, [isAnswering]);

    /* ========== Auto-scroll transcript ========== */
    const scrollToBottom = useCallback(() => {
        const el = scrollBoxRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, []);
    useEffect(() => {
        scrollToBottom();
    }, [transcript, isAnswering, scrollToBottom, interimTextLocal]);

    /* ========== Speech recognition ========== */
    const { isListening, interimText, pendingFinalUser, startListening, stopListening, resetPending, hasSpeechAPI } =
        useSpeechRecognition({
            lang: "en-IN",
            pauseDelay: 1500,
            onFinal: (finalChunk) => {
                // Push each finalized chunk as a 'user' message to show in transcript
                setTranscript((prev) => [...prev, { role: "user", content: finalChunk, ts: now() }]);
            },
            onQuestion: async (completeText) => {
                // Auto-answer when the pending aggregation is a question
                await answerNow(completeText, true);
                resetPending();
            },
            debug: process.env.NODE_ENV !== "production",
        });

    // Mirror to local preview state for the footer line
    useEffect(() => {
        setInterimTextLocal(interimText);
    }, [interimText]);

    /* ========== Answer Now (manual or auto) ========== */
    const answerNow = useCallback(
        async (textOverride?: string, skipPush = false) => {
            if (isAnswering) return;

            const snapInterim = interimText.trim();
            let userText = textOverride?.trim() || pendingFinalUser.trim();
            if (!textOverride && snapInterim) {
                userText = userText ? `${userText} ${snapInterim}` : snapInterim;
            }
            if (!userText) return;

            if (!skipPush) {
                setTranscript((prev) => [...prev, { role: "user", content: userText, ts: now() }]);
            }

            setInterimTextLocal("");
            resetPending();

            const MAX_TURNS = 12;
            const base = transcript.filter((m) => m.role !== "system");
            const recent = base.slice(-MAX_TURNS);
            const messagesForAI = [
                { role: "system" as const, content: SYSTEM_PROMPT },
                ...recent.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
                ...(!skipPush ? ([{ role: "user" as const, content: userText }] as const) : []),
            ];

            await stream(messagesForAI);
        },
        [interimText, isAnswering, pendingFinalUser, transcript, stream, resetPending]
    );

    /* ========== Clear All ========== */
    const clearAll = useCallback(() => {
        abort();
        setTranscript([{ role: "system", content: SYSTEM_PROMPT, ts: now() }]);
        setInterimTextLocal("");
        resetPending();
    }, [abort, resetPending]);

    const cleanTranscript = useMemo(() => transcript.filter((t) => t.role !== "system"), [transcript]);

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
                {/* Transcript window */}
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

                {/* Sticky footer */}
                <div className="sticky bottom-0 bg-background/80 backdrop-blur rounded-md border p-3 space-y-3">
                    <div className="text-sm text-muted-foreground min-h-5">
                        {isListening && interimTextLocal ? <em>Speaking: “{interimTextLocal}”</em> : null}
                    </div>

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
