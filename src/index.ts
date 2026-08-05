import { StateGraph, START, END } from "@langchain/langgraph";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { pathToFileURL } from "node:url";
import "./env.js";

import { getLLM } from "./modelController.js";
import { AgentStateDef } from "./types.js";
import type { LLM_PROVIDERS } from "./types.js";
import { allTools } from "./tools/tools.js";
import { setPageInstance } from "./locators.js";
import { startNetworkCapture } from "./networkCapture.js";
import { startConsoleCapture } from "./consoleCapture.js";
import { startUiSignalCapture } from "./uiSignalCapture.js";
import { logSessionTokenSummary } from "./tokens.js";
import { decideNode } from "./nodes/decideNode.js";
import { executeNode } from "./nodes/executeNode.js";
import { setPageForNodes } from "./nodes/nodeUtil.js";
import { observeNode } from "./nodes/observeNode.js";

/*
    Here is set the agent objective that will be divided in tasks in order to execute them one at a time

    LANGUAGE: You can use whatever language you like, usually English prompts give better results because LLM are mostly trained in English language


    # Buonasera, vai su YouTube e poi cerca video a tuo piacimento e clicca sul primo risultato, poi avvisami a verdev.web@gmail.com quando hai finito

    # Buonasera, vai su MY_URL e compila il form, fammi sapere come va inviandomi un'email a verdev.web@gmail.com 


*/
const OBJECTIVE = process.env.OBJECTIVE || "Buongiorno, vai su YouTube e poi cerca video a tuo piacimento e clicca sul primo risultato, poi avvisami a verdev.web@gmail.com quando hai finito";
const RECURSION_LIMIT = Number(process.env.RECURSION_LIMIT) || 100;
const HEADLESS = (process.env.HEADLESS || "false").toLowerCase() === "true";
const LLM_PROVIDER = (process.env.LLM || "ollama").toLowerCase() as LLM_PROVIDERS;
const LLM_MODEL = process.env.LLM_MODEL || undefined;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || undefined;
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || undefined;
const LMSTUDIO_BASE_URL = process.env.LMSTUDIO_BASE_URL || undefined;

/*
    Here I chose the provider I want

    If you chose LLM Frontier providers such as Anthropic, Google, OpenAI, or LM Studio make sure to put your api key into the .env file!
    LM Studio searches for OPENAI_API_KEY exactly as OpenAI because of the fact that LM Studio exposes an OpenAI compatible API server, so an API key is required in order to handle requests to his enpoints correctly
*/
const llmOptions = {
    ...(LLM_MODEL ? { model: LLM_MODEL } : {}),
    ...(OLLAMA_BASE_URL ? { ollamaBaseUrl: OLLAMA_BASE_URL } : {}),
    ...(OLLAMA_API_KEY ? { ollamaApiKey: OLLAMA_API_KEY } : {}),
    ...(LMSTUDIO_BASE_URL ? { lmstudioBaseUrl: LMSTUDIO_BASE_URL } : {}),
};

const baseLlm = getLLM(LLM_PROVIDER, llmOptions);

if (typeof baseLlm.bindTools !== "function") {
    throw new Error(`Il provider selezionato non supporta nativamente il tool calling.`);
}

const llmWithTools = baseLlm.bindTools(allTools);

// Graph is built here
const workflow = new StateGraph(AgentStateDef)
    .addNode("observe", observeNode)
    .addNode("decide", (state) => decideNode(state, llmWithTools))
    .addNode("execute", executeNode)
    .addEdge(START, "observe")
    .addEdge("observe", "decide")
    .addEdge("decide", "execute")
    .addConditionalEdges("execute", (state) => state.isFinished ? END : "observe");

const app = workflow.compile();

// --- ENTRY POINT ---
export async function runAgent(objective: string = OBJECTIVE) {
    let browser: Browser;
    let page: Page;

    try {
        // Launching the browser instance
        browser = await chromium.launch({ headless: HEADLESS });
        const context = await browser.newContext();
        page = await context.newPage();

        // Passa l'istanza di pagina ai moduli
        setPageInstance(page);
        setPageForNodes(page);
        startNetworkCapture(page);
        startConsoleCapture(page);
        await startUiSignalCapture(page);

        await page.goto("about:blank");

        const initialState = {
            objective,
            currentUrl: "",
            domAst: "",
            lastToolCall: null,
            actionHistory: [],
            completedDomains: [],
            domainStatus: {},
            noToolCallStreak: 0,
            isFinished: false,
            tasks: "",
            consoleLogs: "",
            networkLog: "",
            uiSignals: "",
            realtimeNetworkAlerts: "",
            realtimeConsoleAlerts: ""
        };

        console.log("Agent is starting... ");
        console.log(`[LLM] provider=${LLM_PROVIDER} model=${LLM_MODEL || "default"}`);
        console.log(`[Objective] ${initialState.objective}`);
        // Initialization of the AI Agent setting the recursion limit
        await app.invoke(initialState, { recursionLimit: RECURSION_LIMIT });
    } finally {
        logSessionTokenSummary();
        // await browser?.close();
    }
}

function isDirectRun(): boolean {
    const entryPath = process.argv[1];
    if (!entryPath) return false;
    return import.meta.url === pathToFileURL(entryPath).href;
}

if (isDirectRun()) {
    runAgent().catch(console.error);
}