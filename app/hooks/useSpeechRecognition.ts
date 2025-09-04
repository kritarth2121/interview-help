// hooks/useSpeechRecognition.ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ====== Minimal TS interfaces for Web Speech in the browser ====== */
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
interface SpeechGrammarList {
    addFromString(src: string, weight?: number): void;
    addFromURI(src: string, weight?: number): void;
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

/* ====== Helpers ====== */
const hasSpeechAPI =
    (typeof window !== "undefined" && !!(window as any).SpeechRecognition) ||
    (typeof window !== "undefined" && !!(window as any).webkitSpeechRecognition);

const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

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

type UseSpeechRecognitionOpts = {
    lang?: string; // default 'en-IN'
    pauseDelay?: number; // ms of silence to treat a result as "final", default 1500
    debug?: boolean;
    onFinal?: (finalChunk: string) => void;
    /** Called when the concatenated user text (pending + latest final) reads like a question */
    onQuestion?: (completeText: string) => void;
};

export function useSpeechRecognition(opts: UseSpeechRecognitionOpts = {}) {
    const { lang = "en-IN", pauseDelay = 1500, debug = false, onFinal, onQuestion } = opts;

    const [isListening, setIsListening] = useState(false);
    const [interimText, setInterimText] = useState("");
    const [pendingFinalUser, setPendingFinalUser] = useState("");

    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const keepAliveRef = useRef<boolean>(false);
    const finalizationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const recentFinalsRef = useRef<string[]>([]);

    const isDuplicateFinal = useCallback((s: string) => {
        const key = normalize(s);
        const hit = recentFinalsRef.current.includes(key);
        if (!hit) {
            recentFinalsRef.current.push(key);
            if (recentFinalsRef.current.length > 20) recentFinalsRef.current.shift();
        }
        return hit;
    }, []);

    const ensureRecognizer = useCallback((): SpeechRecognition | null => {
        if (!hasSpeechAPI) return null;
        if (recognitionRef.current) return recognitionRef.current;
        const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        const rec: SpeechRecognition = new Ctor();
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        rec.lang = lang;
        recognitionRef.current = rec;
        return rec;
    }, [lang]);

    const startListening = useCallback(() => {
        if (!hasSpeechAPI) {
            alert("Web Speech API is not supported in this browser.");
            return;
        }
        if (isListening) return;
        const rec = ensureRecognizer();
        if (!rec) return;

        rec.onresult = (ev: SpeechRecognitionEvent) => {
            let interim = "";
            let finalChunk = "";

            for (let i = ev.resultIndex; i < ev.results.length; i++) {
                const result = ev.results[i];
                const alt = result[0];
                if (!alt) continue;
                if (result.isFinal) finalChunk += alt.transcript;
                else interim += alt.transcript;
            }

            if (debug) {
                console.log({ interim, finalChunk });
            }

            setInterimText(interim || "");

            if (finalChunk) {
                const clean = finalChunk.trim();
                if (!clean) return;

                // Clear prior timer and wait for an extra pause before committing final
                if (finalizationTimerRef.current) clearTimeout(finalizationTimerRef.current);
                finalizationTimerRef.current = setTimeout(() => {
                    if (isDuplicateFinal(clean)) return;

                    // Build the "complete" user text so far
                    const completeText = pendingFinalUser ? `${pendingFinalUser.trim()} ${clean}`.trim() : clean;

                    // Update pending aggregation for UX / future checks
                    setPendingFinalUser(completeText);

                    // Notify consumer about this final chunk
                    onFinal?.(clean);

                    // If it reads like a question, trigger callback
                    if (onQuestion && endsWithQuestion(completeText)) {
                        onQuestion(completeText);
                    }
                }, pauseDelay);
            }
        };

        rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
            keepAliveRef.current = false;
            setIsListening(false);
            if (debug) console.warn("Speech error:", ev.error, (ev as any).message);
        };

        rec.onend = () => {
            if (keepAliveRef.current) {
                try {
                    rec.start();
                } catch {
                    setTimeout(() => {
                        try {
                            rec.start();
                        } catch (e) {
                            if (debug) console.error("Failed to restart recognition:", e);
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
            if (debug) console.error("Failed to start recognition:", e);
            keepAliveRef.current = false;
            setIsListening(false);
        }
    }, [debug, ensureRecognizer, isDuplicateFinal, isListening, onFinal, onQuestion, pauseDelay, pendingFinalUser]);

    const stopListening = useCallback(
        (hardAbort = false) => {
            keepAliveRef.current = false;
            setIsListening(false);
            const rec = recognitionRef.current;
            if (!rec) return;
            try {
                hardAbort ? rec.abort() : rec.stop();
            } catch (e) {
                if (debug) console.error("Failed to stop recognition:", e);
            }
        },
        [debug]
    );

    const resetPending = useCallback(() => {
        setInterimText("");
        setPendingFinalUser("");
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stopListening(true);
            if (finalizationTimerRef.current) clearTimeout(finalizationTimerRef.current);
        };
    }, [stopListening]);

    return {
        /** Whether the mic is actively listening */
        isListening,
        /** Current interim (non-final) speech text */
        interimText,
        /** Aggregated committed text across final results (useful for UX) */
        pendingFinalUser,
        /** Start/stop controls */
        startListening,
        stopListening,
        /** Clear interim + pending aggregation (e.g., after sending) */
        resetPending,
        /** Browser support flag */
        hasSpeechAPI,
    };
}
