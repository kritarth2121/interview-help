// app/api/chat/route.ts
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";

export const runtime = "edge";
export const maxDuration = 30;

export async function POST(req: Request) {
    try {
        const { messages } = (await req.json()) as {
            messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
        };

        if (!process.env.OPENAI_API_KEY) {
            return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY on server." }), {
                status: 500,
                headers: { "content-type": "application/json" },
            });
        }

        const result = await streamText({
            model: openai("gpt-4o"),
            messages,
            temperature: 0.7,
            maxTokens: 150,
        });

        // Return the AI SDK **data stream** (SSE). The client will parse only `data:` lines.
        return result.toDataStreamResponse();
    } catch (err) {
        console.error("Error in /api/chat:", err);
        return new Response("Error processing request", { status: 500 });
    }
}
