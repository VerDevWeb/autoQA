import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { LLM_TYPES } from "./types.js";

// --- 1. CONFIGURAZIONE PROVIDER LLM ---
export function getLLM(provider: LLM_TYPES): BaseChatModel {
    switch (provider) {
        case 'openai':
<<<<<<< HEAD
=======
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
>>>>>>> 9afb263 (code refactor => divided index.ts into single files, each file's function or content is explained in the README.ts)
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
                temperature: 0,
                think: false,
            });
            // OLLAMA MODELS TESTED:
            // gemma4:31b-cloud => funziona benissimo, è una scheggia, ma è in cloud
            // gemma4:e2b => funziona e non va neanche troppo lento, spesso ha terminato il flusso prima che il task fosse davvero terminato, considera che però ho usato il pc appena dopo il riavvio, che aveva 5/16GB di RAM occupati
            // qwen3:1.7b => tipo gemma4:e2b, forse leggermente leggermente più lento, spesso ha terminato il flusso prima che il task fosse davvero terminato, memoria RAM 9,7/16GB, avviato dopo aver usato Gemma4:e2b, il quale era stato avviato appena dopo aver riavviato il pc.
            // qwen2.5-coder:3b => molto buono, tipo gemma4:e2b e qwen3:1.7b, più o meno stessa velocità, forse un pochino più veloce ma non ne sono sicuro, anche esso termina il flusso prima di aver effettivamente eseguito tutto il task assegnato.
            // gemma4:e2b-it-qat => piccolino, qualcosa fa
        case 'lmstudio':
            // LM Studio exposes an OpenAI compatible API, so we use ChatOpenAI method
            return new ChatOpenAI({
                model: "qwen/qwen3-1.7b",
                temperature: 0,
                configuration: { baseURL: "http://localhost:1234/v1" }
            });
        default:
            throw new Error(`Provider non supportato: ${provider}`);
    }
}