"use client";

import React, { useState, useEffect, useRef } from "react";
import { Mic, MicOff, MessageCircle, Volume2, Settings, Key, Square, MessagesSquare } from "lucide-react";

// TypeScript interfaces
interface ConversationEntry {
    type: "user" | "ai";
    content: string;
    timestamp: string;
}

interface OpenAIResponse {
    choices: Array<{
        message: {
            content: string;
        };
        delta?: {
            content?: string;
        };
    }>;
}

interface SpeechRecognitionEvent extends Event {
    resultIndex: number;
    results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
    error: string;
}


interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    start(): void;
    stop(): void;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
    onend: (() => void) | null;
}

const VoiceAssistant: React.FC = () => {
    // State with proper TypeScript types
    const [isListening, setIsListening] = useState<boolean>(false);
    const [transcript, setTranscript] = useState<string>("");
    const [allWords, setAllWords] = useState<string[]>([]);
    const [lastAnswer, setLastAnswer] = useState<string>("");
    const [streamingAnswer, setStreamingAnswer] = useState<string>("");
    const [isSupported, setIsSupported] = useState<boolean>(true);
    const [isAnswering, setIsAnswering] = useState<boolean>(false);
    const [isStreaming, setIsStreaming] = useState<boolean>(false);
    const [showSettings, setShowSettings] = useState<boolean>(false);

    const [apiKey, setApiKey] = useState<string>("");

    const [conversationHistory, setConversationHistory] = useState<ConversationEntry[]>([]);

    // Refs with proper types
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const streamControllerRef = useRef<AbortController | null>(null);
    const conversationEndRef = useRef<HTMLDivElement | null>(null);

    // Load API key from localStorage on mount
    useEffect(() => {
        const savedApiKey = localStorage.getItem("openai_api_key");
        if (savedApiKey) {
            setApiKey(savedApiKey);
        }
    }, []);

    // Auto-scroll to bottom of conversation
    useEffect(() => {
        if (conversationEndRef.current) {
            conversationEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [conversationHistory, streamingAnswer]);

    useEffect(() => {
        // Check if speech recognition is supported
        if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
            setIsSupported(false);
            return;
        }

        // Initialize speech recognition
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        (recognitionRef as any).current = new SpeechRecognition();

        if (recognitionRef.current) {
            recognitionRef.current.continuous = true;
            recognitionRef.current.interimResults = true;
            recognitionRef.current.lang = "en-US";

            recognitionRef.current.onresult = (event: SpeechRecognitionEvent) => {
                let finalTranscript = "";
                let interimTranscript = "";

                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        finalTranscript += transcript;
                    } else {
                        interimTranscript += transcript;
                    }
                }

                if (finalTranscript) {
                    const words = finalTranscript
                        .trim()
                        .split(/\s+/)
                        .filter((word) => word.length > 0);
                    setAllWords((prev) => [...prev, ...words]);
                    setTranscript("");
                } else {
                    setTranscript(interimTranscript);
                }
            };

            recognitionRef.current.onerror = (event: SpeechRecognitionErrorEvent) => {
                console.error("Speech recognition error:", event.error);
                if (event.error === "not-allowed") {
                    alert("Microphone access denied. Please allow microphone access and try again.");
                }
            };

            recognitionRef.current.onend = () => {
                if (isListening) {
                    // Restart recognition if it was supposed to be listening
                    setTimeout(() => {
                        if (recognitionRef.current && isListening) {
                            recognitionRef.current.start();
                        }
                    }, 100);
                }
            };

            return () => {
                if (recognitionRef.current) {
                    recognitionRef.current.stop();
                }
                if (streamControllerRef.current) {
                    streamControllerRef.current.abort();
                }
            };
        }
    }, [isListening]);

    const startListening = (): void => {
        if (!isSupported) {
            alert("Speech recognition is not supported in your browser. Please use Chrome or Edge.");
            return;
        }

        setIsListening(true);
        setAllWords([]);
        setLastAnswer("");

        try {
            recognitionRef.current?.start();
        } catch (error) {
            console.error("Error starting recognition:", error);
        }
    };

    const stopListening = (): void => {
        setIsListening(false);
        if (recognitionRef.current) {
            recognitionRef.current.stop();
        }
    };

    const stopStreaming = (): void => {
        if (streamControllerRef.current) {
            streamControllerRef.current.abort();
        }
        setIsStreaming(false);
        if (streamingAnswer) {
            setLastAnswer(streamingAnswer);
            setStreamingAnswer("");

            // Add the partial response to conversation history
            setConversationHistory((prev) => [
                ...prev,
                {
                    type: "ai",
                    content: streamingAnswer + " [interrupted]",
                    timestamp: new Date().toLocaleTimeString(),
                },
            ]);
        }
    };

    const generateAnswer = async (context: string): Promise<string> => {
        try {
            const currentApiKey = apiKey;

            if (!currentApiKey) {
                const errorMsg = "Please set your OpenAI API key in the settings to get AI responses.";
                setLastAnswer(errorMsg);
                setConversationHistory((prev) => [
                    ...prev,
                    {
                        type: "ai",
                        content: errorMsg,
                        timestamp: new Date().toLocaleTimeString(),
                    },
                ]);
                return errorMsg;
            }

            setIsStreaming(true);
            setStreamingAnswer("");
            setLastAnswer("");

            // Create AbortController for stopping streams
            streamControllerRef.current = new AbortController();

            const response = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${currentApiKey}`,
                },
                body: JSON.stringify({
                    model: "gpt-4",
                    messages: [
                        {
                            role: "system",
                            content:
                                "You are a helpful AI assistant that provides brief, relevant responses based on conversation context. Keep responses concise (1-3 sentences) and helpful. Be conversational and engaging.",
                        },
                        {
                            role: "user",
                            content: `Based on this conversation context: "${context}", provide a brief, helpful response or insight.`,
                        },
                    ],
                    max_tokens: 200,
                    temperature: 0.7,
                    stream: true,
                }),
                signal: streamControllerRef.current.signal,
            });

            if (!response.ok) {
                throw new Error(`API request failed: ${response.status}`);
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error("Failed to get response reader");
            }

            const decoder = new TextDecoder();
            let fullResponse = "";

            while (true) {
                const { done, value } = await reader.read();

                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split("\n");

                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        const data = line.slice(6);

                        if (data === "[DONE]") {
                            setIsStreaming(false);
                            setLastAnswer(fullResponse);
                            setStreamingAnswer("");

                            // Add AI response to conversation history
                            setConversationHistory((prev) => [
                                ...prev,
                                {
                                    type: "ai",
                                    content: fullResponse,
                                    timestamp: new Date().toLocaleTimeString(),
                                },
                            ]);

                            // Speak the complete response
                            if ("speechSynthesis" in window && fullResponse) {
                                const utterance = new SpeechSynthesisUtterance(fullResponse);
                                utterance.rate = 0.9;
                                speechSynthesis.speak(utterance);
                            }

                            return fullResponse;
                        }

                        try {
                            const parsed: OpenAIResponse = JSON.parse(data);
                            const content = parsed.choices?.[0]?.delta?.content;

                            if (content) {
                                fullResponse += content;
                                setStreamingAnswer(fullResponse);
                            }
                        } catch (e) {
                            // Skip invalid JSON lines
                        }
                    }
                }
            }

            return fullResponse;
        } catch (error: any) {
            if (error.name === "AbortError") {
                console.log("Stream aborted by user");
                return streamingAnswer || "Response interrupted.";
            }
            console.error("OpenAI API error:", error);
            setIsStreaming(false);
            setStreamingAnswer("");

            const errorMsg =
                "Sorry, I encountered an error connecting to the AI service. Please check your API key and try again.";
            setLastAnswer(errorMsg);
            setConversationHistory((prev) => [
                ...prev,
                {
                    type: "ai",
                    content: errorMsg,
                    timestamp: new Date().toLocaleTimeString(),
                },
            ]);

            return errorMsg;
        }
    };

    const handleAnswer = async (): Promise<void> => {
        if (allWords.length === 0) {
            const errorMsg = "No speech detected yet. Please start speaking first.";
            setLastAnswer(errorMsg);
            setConversationHistory((prev) => [
                ...prev,
                {
                    type: "ai",
                    content: errorMsg,
                    timestamp: new Date().toLocaleTimeString(),
                },
            ]);
            return;
        }

        setIsAnswering(true);

        // Get last 20 words
        const last20Words = allWords.slice(-20).join(" ");

        // Add user input to conversation history
        const timestamp = new Date().toLocaleTimeString();
        setConversationHistory((prev) => [
            ...prev,
            {
                type: "user",
                content: last20Words,
                timestamp: timestamp,
            },
        ]);

        try {
            await generateAnswer(last20Words);
        } catch (error) {
            const errorMsg = "Sorry, I encountered an error generating an answer.";
            setLastAnswer(errorMsg);
            setStreamingAnswer("");
            setIsStreaming(false);
            setConversationHistory((prev) => [
                ...prev,
                {
                    type: "ai",
                    content: errorMsg,
                    timestamp: new Date().toLocaleTimeString(),
                },
            ]);
        } finally {
            setIsAnswering(false);
        }
    };

    const clearAll = (): void => {
        setAllWords([]);
        setTranscript("");
        setLastAnswer("");
        setStreamingAnswer("");
        setIsStreaming(false);
        setConversationHistory([]);
        if (streamControllerRef.current) {
            streamControllerRef.current.abort();
        }
    };

    const saveApiKey = (): void => {
        localStorage.setItem("openai_api_key", apiKey);
        setShowSettings(false);
    };

    const clearApiKey = (): void => {
        localStorage.removeItem("openai_api_key");
        setApiKey("");
    };

    const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
        setApiKey(e.target.value);
    };

    const last20Words = allWords.slice(-20).join(" ");

    if (!isSupported) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
                <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-6 max-w-md text-center">
                    <h2 className="text-xl font-bold text-red-400 mb-2">Browser Not Supported</h2>
                    <p className="text-gray-300">
                        Speech recognition is not supported in your browser. Please use Chrome or Edge.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white">
            <div className="container mx-auto px-4 py-8 max-w-4xl">
                {/* Header */}
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent mb-2">
                        Voice Assistant
                    </h1>
                    <p className="text-gray-400">Speak naturally, then press Answer for AI insights</p>
                </div>

                {/* API Key Status */}
                <div className="flex justify-center mb-4">
                    <div
                        className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm ${
                            apiKey
                                ? "bg-green-900/30 text-green-400 border border-green-500/30"
                                : "bg-orange-900/30 text-orange-400 border border-orange-500/30"
                        }`}
                    >
                        <Key className="w-3 h-3" />
                        {apiKey ? "API Key Configured" : "API Key Required"}
                    </div>
                </div>

                {/* Controls */}
                <div className="flex justify-center gap-4 mb-8 flex-wrap">
                    {!isListening ? (
                        <button
                            onClick={startListening}
                            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 px-6 py-3 rounded-lg transition-colors font-medium"
                        >
                            <Mic className="w-5 h-5" />
                            Start Listening
                        </button>
                    ) : (
                        <button
                            onClick={stopListening}
                            className="flex items-center gap-2 bg-red-600 hover:bg-red-700 px-6 py-3 rounded-lg transition-colors font-medium"
                        >
                            <MicOff className="w-5 h-5" />
                            Stop Listening
                        </button>
                    )}

                    <button
                        onClick={handleAnswer}
                        disabled={allWords.length === 0 || isAnswering || isStreaming}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-6 py-3 rounded-lg transition-colors font-medium"
                    >
                        <MessageCircle className="w-5 h-5" />
                        {isStreaming ? "Streaming..." : isAnswering ? "Thinking..." : "Answer"}
                    </button>

                    {isStreaming && (
                        <button
                            onClick={stopStreaming}
                            className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 px-6 py-3 rounded-lg transition-colors font-medium"
                        >
                            <Square className="w-4 h-4" />
                            Stop
                        </button>
                    )}

                    <button
                        onClick={clearAll}
                        className="flex items-center gap-2 bg-gray-600 hover:bg-gray-700 px-6 py-3 rounded-lg transition-colors font-medium"
                    >
                        Clear All
                    </button>

                    <button
                        onClick={() => setShowSettings(true)}
                        className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 px-6 py-3 rounded-lg transition-colors font-medium"
                    >
                        <Settings className="w-5 h-5" />
                        Settings
                    </button>
                </div>

                {/* Status Indicator */}
                {(isListening || isStreaming) && (
                    <div className="flex items-center justify-center gap-4 mb-6">
                        {isListening && (
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                                <span className="text-red-400 font-medium">Listening...</span>
                            </div>
                        )}
                        {isStreaming && (
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                                <span className="text-green-400 font-medium">AI Responding...</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Live Transcript */}
                {transcript && (
                    <div className="mb-6">
                        <h3 className="text-lg font-semibold mb-2 text-blue-400">Live Speech:</h3>
                        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
                            <p className="text-gray-300 italic">{transcript}</p>
                        </div>
                    </div>
                )}

                {/* Last 20 Words */}
                {last20Words && (
                    <div className="mb-6">
                        <h3 className="text-lg font-semibold mb-2 text-purple-400">Last 20 Words:</h3>
                        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
                            <p className="text-white font-medium">{last20Words}</p>
                            <p className="text-sm text-gray-400 mt-1">Word count: {Math.min(allWords.length, 20)}/20</p>
                        </div>
                    </div>
                )}

                {/* Conversation History */}
                {conversationHistory.length > 0 && (
                    <div className="mb-6">
                        <h3 className="text-lg font-semibold mb-2 text-cyan-400 flex items-center gap-2">
                            <MessagesSquare className="w-5 h-5" />
                            Conversation History ({Math.floor(conversationHistory.length / 2)} exchanges)
                        </h3>
                        <div className="bg-slate-800/30 border border-slate-700 rounded-lg p-4 max-h-96 overflow-y-auto">
                            <div className="space-y-4">
                                {conversationHistory.map((entry: ConversationEntry, index: number) => (
                                    <div
                                        key={index}
                                        className={`flex ${entry.type === "user" ? "justify-end" : "justify-start"}`}
                                    >
                                        <div
                                            className={`max-w-[80%] rounded-lg p-3 ${
                                                entry.type === "user"
                                                    ? "bg-blue-600 text-white ml-4"
                                                    : "bg-slate-700 text-gray-100 mr-4"
                                            }`}
                                        >
                                            <div className="flex items-center gap-2 mb-1">
                                                <span
                                                    className={`text-xs font-medium ${
                                                        entry.type === "user" ? "text-blue-200" : "text-green-400"
                                                    }`}
                                                >
                                                    {entry.type === "user" ? "You" : "AI Assistant"}
                                                </span>
                                                <span className="text-xs text-gray-400">{entry.timestamp}</span>
                                            </div>
                                            <p className="text-sm leading-relaxed">{entry.content}</p>
                                        </div>
                                    </div>
                                ))}

                                {/* Show current streaming response in conversation */}
                                {isStreaming && streamingAnswer && (
                                    <div className="flex justify-start">
                                        <div className="max-w-[80%] rounded-lg p-3 bg-slate-700 text-gray-100 mr-4 border-2 border-green-500/30">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs font-medium text-green-400">AI Assistant</span>
                                                <span className="text-xs text-green-400 animate-pulse">typing...</span>
                                            </div>
                                            <p className="text-sm leading-relaxed">
                                                {streamingAnswer}
                                                <span className="inline-block w-2 h-4 bg-green-400 ml-1 animate-pulse rounded-sm"></span>
                                            </p>
                                        </div>
                                    </div>
                                )}

                                <div ref={conversationEndRef} />
                            </div>
                        </div>
                    </div>
                )}

                {/* AI Answer */}
                {(streamingAnswer || lastAnswer) && (
                    <div className="mb-6">
                        <h3 className="text-lg font-semibold mb-2 text-green-400 flex items-center gap-2">
                            <Volume2 className="w-5 h-5" />
                            Current Response:
                            {isStreaming && <span className="text-sm text-blue-400 animate-pulse">Generating...</span>}
                        </h3>
                        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
                            <p className="text-white leading-relaxed">
                                {streamingAnswer || lastAnswer}
                                {isStreaming && (
                                    <span className="inline-block w-2 h-5 bg-green-400 ml-1 animate-pulse rounded-sm"></span>
                                )}
                            </p>
                        </div>
                    </div>
                )}

                {/* All Captured Words */}
                {allWords.length > 0 && (
                    <div>
                        <h3 className="text-lg font-semibold mb-2 text-gray-400">
                            Full Conversation ({allWords.length} words):
                        </h3>
                        <div className="bg-slate-800/30 border border-slate-700 rounded-lg p-4 max-h-40 overflow-y-auto">
                            <p className="text-gray-300 text-sm leading-relaxed">{allWords.join(" ")}</p>
                        </div>
                    </div>
                )}

                {/* Instructions */}
                <div className="mt-8 bg-slate-800/30 border border-slate-600 rounded-lg p-4">
                    <h4 className="font-semibold text-yellow-400 mb-2">How to use:</h4>
                    <ol className="text-sm text-gray-300 space-y-1">
                        <li>1. Click Settings and enter your OpenAI API key (required for AI responses)</li>
                        <li>2. Click Start Listening to begin voice recognition</li>
                        <li>3. Speak naturally - your words will be captured in real-time</li>
                        <li>4. Click Answer to get AI insights streaming in real-time</li>
                        <li>5. Watch responses appear word-by-word in both sections</li>
                        <li>6. View full conversation history in chat format</li>
                        <li>7. Responses are spoken aloud automatically</li>
                        <li>8. Use Stop to interrupt streaming responses if needed</li>
                    </ol>
                </div>

                {/* Settings Modal */}
                {showSettings && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 w-full max-w-md">
                            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                                <Key className="w-5 h-5" />
                                API Settings
                            </h3>

                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-300 mb-2">OpenAI API Key</label>
                                <input
                                    type="password"
                                    value={apiKey}
                                    onChange={handleApiKeyChange}
                                    placeholder="sk-..."
                                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <p className="text-xs text-gray-400 mt-1">
                                    Get your API key from{" "}
                                    <a
                                        href="https://platform.openai.com/api-keys"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-400 hover:underline"
                                    >
                                        OpenAI Platform
                                    </a>
                                </p>
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={saveApiKey}
                                    disabled={!apiKey.trim()}
                                    className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-4 py-2 rounded-lg transition-colors font-medium"
                                >
                                    Save
                                </button>
                                <button
                                    onClick={clearApiKey}
                                    className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg transition-colors font-medium"
                                >
                                    Clear
                                </button>
                                <button
                                    onClick={() => setShowSettings(false)}
                                    className="bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded-lg transition-colors font-medium"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default VoiceAssistant;
