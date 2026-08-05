import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { LLM_PROVIDERS } from "./types.js";

type LLMOptions = {
    model?: string;
    temperature?: number;
    ollamaBaseUrl?: string;
    ollamaApiKey?: string;
    lmstudioBaseUrl?: string;
};


/*
    THIS FILE HANDLES THE LLM PROVIDER TO CHOSE FOR RUNNING THE AGENT

    this is made possbile thanks to the getLLM method that let's you:
    - select the LLMProvider (chose one from LLM_PROVIDERS) that the agent's brain will use
    - select the LLM (LLM's APIs codename) that the agent's brain will use
*/

export function getLLM(provider: LLM_PROVIDERS, options: LLMOptions = {}): BaseChatModel {
    const temperature = options.temperature ?? 0;

    switch (provider) {
        case 'openai':
            return new ChatOpenAI({
                model: options.model || "gpt-4o",
                temperature
            });
        case 'anthropic':
            return new ChatAnthropic({
                model: options.model || "claude-3-5-sonnet-20240620",
                temperature
            });
        case 'google':
            return new ChatGoogleGenerativeAI({
                model: options.model || "gemma-4-31b-it",
                temperature
            });
        case 'ollama':
            return new ChatOllama({
                baseUrl: options.ollamaBaseUrl || "http://localhost:11434",
                model: options.model || "gemma4:31b-cloud",
                temperature,
                ...(options.ollamaApiKey
                    ? { headers: { Authorization: `Bearer ${options.ollamaApiKey}` } }
                    : {})
            });
            // TESTED OLLAMA MODELS:
            // gemma4:31b-cloud
            // gemma4:e2b
            // qwen3:1.7b
        case 'lmstudio':
            return new ChatOpenAI({
                model: options.model || "local-model",
                temperature,
                configuration: { baseURL: options.lmstudioBaseUrl || "http://localhost:1234/v1" }
            });
        default:
            throw new Error(`Provider non supportato: ${provider}`);
    }
}