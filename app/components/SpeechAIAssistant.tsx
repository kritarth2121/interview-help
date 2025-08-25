"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, MessageSquare, Volume2 } from "lucide-react";

// Complete SpeechRecognition interface
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
    message: string;
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
        SpeechRecognition: new () => SpeechRecognition;
        webkitSpeechRecognition: new () => SpeechRecognition;
    }
}

export default function SpeechAIAssistant() {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState("");
    const [words, setWords] = useState<string[]>([]);
    const [aiResponse, setAiResponse] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSupported, setIsSupported] = useState(false);
    const [apiError, setApiError] = useState<string | null>(null);

    const recognitionRef = useRef<SpeechRecognition | null>(null);

    useEffect(() => {
        // Check if speech recognition is supported
        if (typeof window !== "undefined") {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRecognition) {
                setIsSupported(true);
                recognitionRef.current = new SpeechRecognition();
                if (recognitionRef.current) {
                    const recognition = recognitionRef.current;
                    recognition.continuous = true;
                    recognition.interimResults = true;
                    recognition.lang = "en-US";

                    recognition.onstart = () => {
                        console.log("Speech recognition started");
                    };

                    recognition.onresult = (event: SpeechRecognitionEvent) => {
                        let finalTranscript = "";

                        for (let i = event.resultIndex; i < event.results.length; i++) {
                            const transcript = event.results[i][0].transcript;
                            if (event.results[i].isFinal) {
                                finalTranscript += transcript + " ";
                            }
                        }

                        if (finalTranscript) {
                            setTranscript((prev) => prev + finalTranscript);
                            const newWords = finalTranscript
                                .trim()
                                .split(/\s+/)
                                .filter((word) => word.length > 0);
                            setWords((prev) => [...prev, ...newWords]);
                        }
                    };

                    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
                        console.error("Speech recognition error:", event.error);

                        // Handle specific error types
                        switch (event.error) {
                            case "not-allowed":
                                alert("Microphone access denied. Please allow microphone access and try again.");
                                break;
                            case "no-speech":
                                console.log("No speech detected, continuing...");
                                break;
                            case "audio-capture":
                                alert("No microphone found. Please check your microphone connection.");
                                break;
                            case "network":
                                console.log("Network error in speech recognition, but continuing...");
                                break;
                            case "service-not-allowed":
                                alert("Speech recognition service not allowed. Please try using HTTPS.");
                                break;
                            case "aborted":
                                console.log("Speech recognition aborted");
                                break;
                            case "language-not-supported":
                                alert("Language not supported. Trying with default language...");
                                break;
                            default:
                                console.log(`Speech recognition error: ${event.error}`);
                        }

                        // Only stop listening for critical errors
                        if (["not-allowed", "audio-capture", "service-not-allowed"].includes(event.error)) {
                            setIsListening(false);
                        }
                    };

                    recognition.onend = () => {
                        console.log("Speech recognition ended");
                        // Restart if we're supposed to be listening and no critical error occurred
                        if (isListening) {
                            try {
                                recognition.start();
                            } catch (error) {
                                console.error("Failed to restart recognition:", error);
                                setIsListening(false);
                            }
                        }
                    };
                }
            } else {
                setIsSupported(false);
            }
        }

        return () => {
            if (recognitionRef.current) {
                try {
                    recognitionRef.current.stop();
                } catch (error) {
                    console.error("Error stopping recognition:", error);
                }
            }
        };
    }, [isListening]);

    const startListening = async () => {
        if (!recognitionRef.current) return;

        try {
            // Request microphone permission first
            await navigator.mediaDevices.getUserMedia({ audio: true });

            if (!isListening) {
                setIsListening(true);
                recognitionRef.current.start();
            }
        } catch (error: any) {
            console.error("Error starting speech recognition:", error);

            if (error.name === "NotAllowedError") {
                alert("Microphone access denied. Please allow microphone access in your browser settings.");
            } else if (error.name === "NotFoundError") {
                alert("No microphone found. Please connect a microphone and try again.");
            } else {
                alert("Error accessing microphone. Please check your browser settings and try again.");
            }

            setIsListening(false);
        }
    };

    const stopListening = () => {
        if (recognitionRef.current && isListening) {
            try {
                setIsListening(false);
                recognitionRef.current.stop();
            } catch (error) {
                console.error("Error stopping recognition:", error);
                setIsListening(false);
            }
        }
    };

    const getAIResponse = async () => {
        const last20Words = words.slice(-20).join(" ");

        if (!last20Words.trim()) {
            alert("No words detected. Please speak something first.");
            return;
        }

        setIsGenerating(true);
        setAiResponse(""); // Clear previous response
        setApiError(null); // Clear previous API errors

        try {
            // Check if the API endpoint exists
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    messages: [
                        {
                            role: "system",
                            content:
                                "You are a helpful AI assistant. Respond naturally and conversationally to what the user just said. Keep your response concise and relevant.",
                        },
                        {
                            role: "user",
                            content: `Please respond to this: "${last20Words}"`,
                        },
                    ],
                }),
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value);
                    const lines = chunk.split("\n");

                    for (const line of lines) {
                        if (line.startsWith("0:")) {
                            try {
                                const data = JSON.parse(line.slice(2));
                                if (data.type === "text-delta") {
                                    // Update response in real-time by appending each delta
                                    setAiResponse((prev) => prev + data.textDelta);
                                }
                            } catch (e) {
                                // Ignore parsing errors for streaming data
                                console.warn("Failed to parse streaming data:", e);
                            }
                        }
                    }
                }
            }
        } catch (error: any) {
            console.error("Error getting AI response:", error);

            // Provide more specific error handling
            if (error.name === "TypeError" && error.message.includes("fetch")) {
                setApiError("API endpoint not available. Please ensure your backend server is running.");
                setAiResponse(
                    "I'm sorry, but I can't connect to the AI service right now. The backend API appears to be unavailable."
                );
            } else if (error.message.includes("404")) {
                setApiError("API endpoint not found. Please check if '/api/chat' route is properly configured.");
                setAiResponse("The AI service endpoint is not configured. Please set up the backend API.");
            } else if (error.message.includes("500")) {
                setApiError("Server error occurred. Please try again later.");
                setAiResponse("The AI service is experiencing issues. Please try again in a moment.");
            } else {
                setApiError(`Network error: ${error.message}`);
                setAiResponse("Sorry, I encountered a network error while trying to generate a response.");
            }
        } finally {
            setIsGenerating(false);
        }
    };

    const clearTranscript = () => {
        setTranscript("");
        setWords([]);
        setAiResponse("");
        setApiError(null);
    };

    const speakResponse = () => {
        if (aiResponse && "speechSynthesis" in window) {
            // Stop any current speech
            speechSynthesis.cancel();

            const utterance = new SpeechSynthesisUtterance(aiResponse);
            utterance.rate = 0.9;
            utterance.pitch = 1;
            utterance.volume = 1;

            // Add error handling for speech synthesis
            utterance.onerror = (event) => {
                console.error("Speech synthesis error:", event);
            };

            speechSynthesis.speak(utterance);
        } else {
            alert("Speech synthesis is not supported in your browser.");
        }
    };

    if (!isSupported) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
                <Card className="w-full max-w-md">
                    <CardContent className="p-6 text-center">
                        <h2 className="text-xl font-semibold mb-4">Speech Recognition Not Supported</h2>
                        <p className="text-gray-600">
                            Your browser doesnt support speech recognition. Please use Chrome, Edge, or Safari.
                        </p>
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
                    <p className="text-gray-600">Speak naturally, and Ill respond to your last 20 words</p>
                </div>

                {/* Error Display */}
                {apiError && (
                    <Card className="border-red-200 bg-red-50">
                        <CardContent className="p-4">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 bg-red-500 rounded-full"></div>
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
                                onClick={getAIResponse}
                                disabled={words.length === 0 || isGenerating}
                                size="lg"
                                className="flex items-center gap-2"
                            >
                                <MessageSquare className="w-5 h-5" />
                                {isGenerating ? "Generating..." : "Get AI Response"}
                            </Button>

                            <Button onClick={clearTranscript} variant="outline" size="lg">
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

                {/* Last 20 Words */}
                {last20Words.length > 0 && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Last 20 Words (AI will respond to this)</CardTitle>
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
                                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                                        <div
                                            className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
                                            style={{ animationDelay: "0.1s" }}
                                        ></div>
                                        <div
                                            className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
                                            style={{ animationDelay: "0.2s" }}
                                        ></div>
                                    </div>
                                )}
                            </CardTitle>
                            {aiResponse && !isGenerating && (
                                <Button
                                    onClick={speakResponse}
                                    variant="outline"
                                    size="sm"
                                    className="flex items-center gap-2 bg-transparent"
                                >
                                    <Volume2 className="w-4 h-4" />
                                    Speak
                                </Button>
                            )}
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
