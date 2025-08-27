"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, MessageSquare } from "lucide-react";

/* ====================== Web Speech API Types ====================== */
interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    maxAlternatives: number;
    serviceURI: string;
    grammars: SpeechGrammarList;
    start(): void;
    stop(): void;
    abort(): void;
    onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
    onend: ((this: SpeechRecognition, ev: Event) => any) | null;
    onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
    onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
    onnomatch: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
    onsoundstart: ((this: SpeechRecognition, ev: Event) => any) | null;
    onsoundend: ((this: SpeechRecognition, ev: Event) => any) | null;
    onspeechstart: ((this: SpeechRecognition, ev: Event) => any) | null;
    onspeechend: ((this: SpeechRecognition, ev: Event) => any) | null;
    onaudiostart: ((this: SpeechRecognition, ev: Event) => any) | null;
    onaudioend: ((this: SpeechRecognition, ev: Event) => any) | null;
}
interface SpeechRecognitionErrorEvent extends Event {
    error: string;
    message?: string;
}
interface SpeechRecognitionEvent extends Event {
    results: SpeechRecognitionResultList;
    resultIndex: number;
}
interface SpeechRecognitionResultList {
    readonly length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResult {
    readonly length: number;
    item(index: number): SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative;
    isFinal: boolean;
}
interface SpeechRecognitionAlternative {
    transcript: string;
    confidence: number;
}
interface SpeechGrammarList {
    readonly length: number;
    item(index: number): SpeechGrammar;
    [index: number]: SpeechGrammar;
    addFromURI(src: string, weight?: number): void;
    addFromString(string: string, weight?: number): void;
}
interface SpeechGrammar {
    src: string;
    weight: number;
}
declare global {
    interface Window {
        SpeechRecognition: { new (): SpeechRecognition };
        webkitSpeechRecognition: { new (): SpeechRecognition };
    }
}

/* =========================== Component ============================ */
export default function SpeechAIAssistant() {
    const [isListening, setIsListening] = useState(false);
    const [isSupported, setIsSupported] = useState(false);

    const [transcript, setTranscript] = useState(""); // full final transcript
    const [interimTranscript, setInterimTranscript] = useState(""); // live interim
    const [words, setWords] = useState<string[]>([]); // final words list

    const [aiResponse, setAiResponse] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);
    const [apiError, setApiError] = useState<string | null>(null);

    const recognitionRef = useRef<SpeechRecognition | null>(null);

    // ---- SR state guards & activity tracking ----
    const isStartingRef = useRef(false);
    const lastHeardAtRef = useRef<number>(Date.now());
    const keepAliveTimerRef = useRef<number | null>(null);

    const safeStart = async () => {
        const rec = recognitionRef.current;
        if (!rec) return;
        if (isStartingRef.current) return;
        isStartingRef.current = true;
        try {
            rec.start();
        } catch {
            // swallow; Chrome throws if called too soon
        } finally {
            // give the engine a beat before allowing another start
            window.setTimeout(() => {
                isStartingRef.current = false;
            }, 300);
        }
    };

    const safeStop = () => {
        const rec = recognitionRef.current;
        if (!rec) return;
        try {
            rec.stop();
        } catch {}
    };

    const forceRestartRecognition = () => {
        // hard reset: stop -> small delay -> start
        safeStop();
        window.setTimeout(() => {
            safeStart();
        }, 250);
    };

    // Autosend machinery
    const autoTickRef = useRef<number | null>(null);
    const lastSentIndexRef = useRef(0);

    const wordsRef = useRef<string[]>([]);
    useEffect(() => {
        wordsRef.current = words;
    }, [words]);

    const isGeneratingRef = useRef(false);
    useEffect(() => {
        isGeneratingRef.current = isGenerating;
    }, [isGenerating]);

    // mirror interim transcript for autosend fallback
    const interimRef = useRef("");
    useEffect(() => {
        interimRef.current = interimTranscript;
    }, [interimTranscript]);

    // watchdog timer id for long-running generations
    const genWatchdogRef = useRef<number | null>(null);

    // Initialize recognition instance & lifecycle
    useEffect(() => {
        if (typeof window === "undefined") return;

        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            setIsSupported(false);
            return;
        }
        setIsSupported(true);

        const rec = new SR();
        recognitionRef.current = rec;

        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = "en-IN";

        rec.onstart = () => {
            // session started; mark activity so keep-alive doesn’t fire immediately
            lastHeardAtRef.current = Date.now();
        };

        rec.onresult = (event: SpeechRecognitionEvent) => {
            lastHeardAtRef.current = Date.now(); // 🔑 any event = activity
            let finalPart = "";
            let interimPart = "";

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const seg = event.results[i][0].transcript;
                if (event.results[i].isFinal) finalPart += seg + " ";
                else interimPart += seg + " ";
            }

            setInterimTranscript(interimPart);
            if (finalPart) {
                setTranscript((prev) => prev + finalPart);
                const newWords = finalPart.trim().split(/\s+/).filter(Boolean);
                if (newWords.length) setWords((prev) => [...prev, ...newWords]);
            }
        };

        rec.onerror = (event: SpeechRecognitionErrorEvent) => {
            // common, non-fatal errors we should recover from
            const e = event.error;
            if (e === "no-speech" || e === "aborted" || e === "network") {
                // quick recycle tends to work best
                if (isListening) {
                    forceRestartRecognition();
                }
                return;
            }

            if (["not-allowed", "audio-capture", "service-not-allowed"].includes(e)) {
                // fatal; stop listening
                setIsListening(false);
            } else {
                // other weird errors: try a quick recycle
                if (isListening) forceRestartRecognition();
            }
        };

        rec.onend = () => {
            // Chrome will call this after ~30–60s of silence.
            if (isListening) {
                // small delay is important; immediate start often throws
                setTimeout(() => {
                    safeStart();
                }, 300);
            }
        };

        rec.onaudioend = () => {
            setInterimTranscript("");
        };

        return () => {
            try {
                rec.stop();
            } catch {}
            recognitionRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isListening]);

    const startListening = async () => {
        if (!recognitionRef.current) return;
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            setIsListening(true);
            lastHeardAtRef.current = Date.now();
            await safeStart();
        } catch (error: any) {
            setIsListening(false);
            const name = error?.name || "";
            if (name === "NotAllowedError") alert("Microphone access denied. Enable mic permissions and retry.");
            else if (name === "NotFoundError") alert("No microphone detected. Please connect a mic and retry.");
            else alert("Microphone error. Check browser permissions and try again.");
        }
    };

    const stopListening = () => {
        setIsListening(false);
        safeStop();
    };

    // 5-second auto-respond loop

    useEffect(() => {
        if (!isListening) {
            if (keepAliveTimerRef.current) {
                clearInterval(keepAliveTimerRef.current);
                keepAliveTimerRef.current = null;
            }
            return;
        }

        // check every 5s; if no activity for 10s, recycle SR
        keepAliveTimerRef.current = window.setInterval(() => {
            const idleMs = Date.now() - lastHeardAtRef.current;
            if (idleMs > 10000) {
                // stale session; recycle
                forceRestartRecognition();
                lastHeardAtRef.current = Date.now();
            }
        }, 5000);

        return () => {
            if (keepAliveTimerRef.current) {
                clearInterval(keepAliveTimerRef.current);
                keepAliveTimerRef.current = null;
            }
        };
    }, [isListening]);

    useEffect(() => {
        if (autoTickRef.current) {
            clearInterval(autoTickRef.current);
            autoTickRef.current = null;
        }
        if (!isListening) return;

        autoTickRef.current = window.setInterval(() => {
            if (isGeneratingRef.current) return;

            const wordsNow = wordsRef.current;
            const newFinalWords = wordsNow.slice(lastSentIndexRef.current);
            const hasNewFinal = newFinalWords.length > 0;

            // Build payload: prefer new final words; else fallback to interim text
            const payload = hasNewFinal ? newFinalWords.join(" ") : (interimRef.current || "").trim();

            if (!payload) return;

            // fire and conditionally move the cursor only if we sent final words & it succeeded
            (async () => {
                const ok = await getAIResponse(payload, /*isAuto*/ true);
                if (ok && hasNewFinal) {
                    lastSentIndexRef.current = wordsNow.length; // advance only on success
                }
            })();
        }, 5000);

        return () => {
            if (autoTickRef.current) {
                clearInterval(autoTickRef.current);
                autoTickRef.current = null;
            }
        };
    }, [isListening]);

    // Manual response still available (uses last 20 words)
    const manualRespond = () => {
        const last20 = words.slice(-20).join(" ").trim();
        if (!last20) {
            alert("No captured speech yet. Please speak first.");
            return;
        }
        getAIResponse(last20, false);
    };

    // Core: fetch AI response (streaming-friendly)
    const getAIResponse = async (promptOverride?: string, isAuto = false): Promise<boolean> => {
        const prompt = (promptOverride ?? words.slice(-20).join(" ")).trim();
        if (!prompt) {
            if (!isAuto) alert("No words to send.");
            return false;
        }

        setIsGenerating(true);
        setAiResponse("");
        setApiError(null);

        // watchdog: if the stream hangs, clear isGenerating so autosend can resume
        if (genWatchdogRef.current) {
            clearTimeout(genWatchdogRef.current);
            genWatchdogRef.current = null;
        }
        genWatchdogRef.current = window.setTimeout(() => {
            setIsGenerating(false);
        }, 15000);

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: [
                        {
                            role: "system",
                            content:
                                "You are a helpful AI Tech assistant. Respond naturally and conversationally to what the user just said. Keep it concise and relevant.",
                        },
                        { role: "user", content: `Please respond to this: "${prompt}"` },
                    ],
                }),
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (!reader) {
                const text = await response.text();
                setAiResponse(text);
                return true;
            }

            let buffer = "";
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    try {
                        if (trimmed.startsWith("0:")) {
                            let content = trimmed.slice(2);
                            if (content.startsWith('"') && content.endsWith('"')) {
                                content = content.slice(1, -1);
                            }
                            content = content
                                .replace(/\\n/g, "\n")
                                .replace(/\\t/g, "\t")
                                .replace(/\\"/g, '"')
                                .replace(/\\\\/g, "\\");
                            if (content) setAiResponse((prev) => prev + content);
                        } else if (trimmed.startsWith("data:")) {
                            const data = trimmed.slice(5).trim();
                            if (data === "[DONE]") continue;
                            const parsed = JSON.parse(data);
                            const piece = parsed?.choices?.[0]?.delta?.content;
                            if (piece) setAiResponse((prev) => prev + piece);
                        }
                    } catch {
                        // ignore unparsable line
                    }
                }
            }

            return true;
        } catch (err: any) {
            const msg = err?.message || "Network error";
            setApiError(msg);
            setAiResponse("Sorry, I couldn't reach the AI service.");
            return false;
        } finally {
            if (genWatchdogRef.current) {
                clearTimeout(genWatchdogRef.current);
                genWatchdogRef.current = null;
            }
            setIsGenerating(false);
        }
    };

    const clearAll = () => {
        setTranscript("");
        setInterimTranscript("");
        setWords([]);
        setAiResponse("");
        setApiError(null);
        lastSentIndexRef.current = 0;
    };

    if (!isSupported) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
                <Card className="w-full max-w-md">
                    <CardContent className="p-6 text-center">
                        <h2 className="text-xl font-semibold mb-4">Speech Recognition Not Supported</h2>
                        <p className="text-gray-600">Use Chrome, Edge, or Safari on desktop for best results.</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const last20Words = words.slice(-20);

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
            <div className="max-w-4xl mx-auto space-y-6">
                <div className="text-center">
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">AI Speech Assistant</h1>
                    <p className="text-gray-600">
                        I’m listening continuously. I’ll auto-respond every 5 seconds to the new words you speak.
                    </p>
                </div>

                {/* Error */}
                {apiError && (
                    <Card className="border-red-200 bg-red-50">
                        <CardContent className="p-4">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 bg-red-500 rounded-full" />
                                <p className="text-red-700 text-sm font-medium">API Error: {apiError}</p>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Controls */}
                <Card>
                    <CardContent className="p-6">
                        <div className="flex flex-wrap gap-4 justify-center">
                            <Button
                                onClick={isListening ? stopListening : startListening}
                                variant={isListening ? "destructive" : "default"}
                                size="lg"
                                className="flex items-center gap-2"
                            >
                                {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                                {isListening ? "Stop Listening" : "Start Listening"}
                            </Button>

                            <Button
                                onClick={manualRespond}
                                disabled={words.length === 0 || isGenerating}
                                size="lg"
                                className="flex items-center gap-2"
                            >
                                <MessageSquare className="w-5 h-5" />
                                {isGenerating ? "Generating..." : "Respond (last 20 words)"}
                            </Button>

                            <Button onClick={clearAll} variant="outline" size="lg">
                                Clear All
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* Status */}
                <div className="flex justify-center">
                    <Badge variant={isListening ? "default" : "secondary"} className="text-sm px-4 py-2">
                        {isListening ? "🎤 Listening..." : "🔇 Not Listening"}
                    </Badge>
                </div>

                {/* Live interim preview */}
                {interimTranscript && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Listening (live)</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="bg-white border rounded-lg p-3 text-gray-700">{interimTranscript}</div>
                        </CardContent>
                    </Card>
                )}

                {/* Last 20 Words */}
                {last20Words.length > 0 && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Last 20 Words (manual response uses this)</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                                <p className="text-gray-800 font-medium">{last20Words.join(" ")}</p>
                                <p className="text-sm text-gray-500 mt-2">Word count: {last20Words.length}/20</p>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* AI Response */}
                {(aiResponse || isGenerating) && (
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle className="text-lg flex items-center gap-2">
                                AI Response
                                {isGenerating && (
                                    <div className="flex space-x-1">
                                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" />
                                        <div
                                            className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
                                            style={{ animationDelay: "0.1s" }}
                                        />
                                        <div
                                            className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
                                            style={{ animationDelay: "0.2s" }}
                                        />
                                    </div>
                                )}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                <p className="text-gray-800">
                                    {aiResponse}
                                    {isGenerating && (
                                        <span className="inline-block w-2 h-5 bg-blue-500 animate-pulse ml-1">|</span>
                                    )}
                                </p>
                                {!aiResponse && isGenerating && (
                                    <p className="text-gray-500 italic">AI is thinking...</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Full Transcript */}
                {transcript && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Full Conversation Transcript</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="bg-gray-50 border rounded-lg p-4 max-h-60 overflow-y-auto">
                                <p className="text-gray-700 whitespace-pre-wrap">{transcript}</p>
                                <p className="text-sm text-gray-500 mt-2">Total words: {words.length}</p>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}
