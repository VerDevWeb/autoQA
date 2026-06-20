import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

// --- 1. CONFIGURAZIONE PROVIDER LLM ---
export function getLLM(provider: 'openai' | 'anthropic' | 'google' | 'ollama' | 'lmstudio'): BaseChatModel {
    switch (provider) {
        case 'openai':
            return new ChatOpenAI({ model: "gpt-4o", temperature: 0 });
        case 'anthropic':
            return new ChatAnthropic({ model: "claude-3-5-sonnet-20240620", temperature: 0 });
        case 'google':
            return new ChatGoogleGenerativeAI({ model: "gemma-4-31b-it", temperature: 0 });
        case 'ollama':
            return new ChatOllama({ baseUrl: "http://localhost:11434", model: "gemma4:31b-cloud", temperature: 0 });
        case 'lmstudio':
            return new ChatOpenAI({
                model: "local-model",
                temperature: 0,
                configuration: { baseURL: "http://localhost:1234/v1" }
            });
        default:
            throw new Error(`Provider non supportato: ${provider}`);
    }
}