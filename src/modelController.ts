import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { LLM_PROVIDERS } from "./types.js";


/*
    THIS FILE HANDLES THE LLM PROVIDER TO CHOSE FOR RUNNING THE AGENT

    this is made possbile thanks to the getLLM method that let's you:
    - select the LLMProvider (chose one from LLM_PROVIDERS) that the agent's brain will use
    - select the LLM (LLM's APIs codename) that the agent's brain will use
*/

export function getLLM(provider: LLM_PROVIDERS): BaseChatModel {
    switch (provider) {
        case 'openai':
            return new ChatOpenAI({
                model: "gpt-4o",
                temperature: 0
            });
        case 'anthropic':
            return new ChatAnthropic({
                model: "claude-3-5-sonnet-20240620",
                temperature: 0
            });
        case 'google':
            return new ChatGoogleGenerativeAI({
                model: "gemma-4-31b-it",
                temperature: 0
            });
        case 'ollama':
            return new ChatOllama({
                baseUrl: "http://localhost:11434",
                model: "gemma4:31b-cloud",
                temperature: 0 
            });
            // TESTED OLLAMA MODELS:
            // gemma4:31b-cloud
            // gemma4:e2b
            // qwen3:1.7b
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