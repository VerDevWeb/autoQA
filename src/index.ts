import { StateGraph, START, END } from "@langchain/langgraph";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import * as dotenv from "dotenv";

import { getLLM } from "./modelController.js";
import { AgentStateDef } from "./types.js";
import { allTools } from "./tools/tools.js";
import { setPageInstance } from "./locators.js";
import { startNetworkCapture } from "./networkCapture.js";
import { startConsoleCapture } from "./consoleCapture.js";
import { logSessionTokenSummary } from "./tokens.js";
import { decideNode } from "./nodes/decideNode.js";
import { executeNode } from "./nodes/executeNode.js";
import { setPageForNodes } from "./nodes/nodeUtil.js";
import { observeNode } from "./nodes/observeNode.js";

dotenv.config();

/*
    Here is set the agent objective that will be divided in tasks in order to execute them one at a time

    LANGUAGE: You can use whatever language you like, usually English prompts give better results because LLM are mostly trained in English language
*/
const OBJECTIVE = process.env.OBJECTIVE || "";
const RECURSION_LIMIT = Number(process.env.RECURSION_LIMIT) || 100;
const HEADLESS = Boolean(process.env.HEADLESS) || false;

/*
    Here I chose the provider I want

    If you chose LLM Frontier providers such as Anthropic, Google, OpenAI, or LM Studio make sure to put your api key into the .env file!
    LM Studio searches for OPENAI_API_KEY exactly as OpenAI because of the fact that LM Studio exposes an OpenAI compatible API server, so an API key is required in order to handle requests to his enpoints correctly
*/
const baseLlm = getLLM('ollama');

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
async function run() {
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

        await page.goto("about:blank");

        const initialState = {
            objective: OBJECTIVE,
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
            networkLog: ""
        };

        console.log("Agent is starting... ");
        console.log(`[Objective] ${initialState.objective}`);
        // Initialization of the AI Agent setting the recursion limit
        await app.invoke(initialState, { recursionLimit: RECURSION_LIMIT });
    } finally {
        logSessionTokenSummary();
        // await browser?.close();
    }
}

run().catch(console.error);