import { StateGraph, START, END } from "@langchain/langgraph";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import * as dotenv from "dotenv";
import { getLLM } from "./modelController.js";
import { AgentStateDef, webActionSchema } from "./types.js";
import { observeNode, decideNode, executeNode, setPageForNodes } from "./nodes.js";
import { setPageInstance } from "./locators.js";
import { logSessionTokenSummary } from "./tokens.js";

dotenv.config();

// --- CONSTANTI ---
const OBJECTIVE = "Vai su it.wikipedia.org, clicca su testo grande e tema scuro dal menu laterale, poi digita 'Reggio Emilia' nella barra di ricerca ed esegui la ricerca premendo Invio.";

// Vai su it.wikipedia.org, poi digita 'Reggio Emilia' nella barra di ricerca ed esegui la ricerca premendo Invio. Poi vai su youtube.com, cerca video sull'ai e clicca sul primo risultato

// --- SETUP LLM ---
const baseLlm = getLLM('ollama');

// Controlla se il provider selezionato supporta a livello nativo il tool calling, eventualmente si dovrebbe poter fare un workaround
if (typeof baseLlm.bindTools !== "function") {
    throw new Error(`Il provider selezionato non supporta nativamente il tool calling.`);
}

const llmWithTools = baseLlm.bindTools([{
    name: "execute_web_action",
    description: "Esegue un'azione sulla pagina web basandosi sugli ID dell'AST fornito.",
    schema: webActionSchema
}]);

// --- COSTRUZIONE GRAFO ---
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
        browser = await chromium.launch({ headless: false });
        const context = await browser.newContext();
        page = await context.newPage();

        // Passa l'istanza di pagina ai moduli
        setPageInstance(page);
        setPageForNodes(page);

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
            isFinished: false
        };

        console.log("Avvio del flusso con Native Tool Calling...");
        console.log(`[Objective] ${initialState.objective}`);
        await app.invoke(initialState, { recursionLimit: 100 });

        console.log("Flusso terminato con successo.");
    } finally {
        logSessionTokenSummary();
        // await browser?.close();
    }
}

run().catch(console.error);