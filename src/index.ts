import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { z } from "zod";
import * as dotenv from "dotenv";

dotenv.config();

// --- 1. CONFIGURAZIONE PROVIDER LLM ---
function getLLM(provider: 'openai' | 'anthropic' | 'google' | 'ollama' | 'lmstudio'): BaseChatModel {
    switch (provider) {
        case 'openai':
            return new ChatOpenAI({ model: "gpt-4o", temperature: 0 });
        case 'anthropic':
            return new ChatAnthropic({ model: "claude-3-5-sonnet-20240620", temperature: 0 });
        case 'google':
            return new ChatGoogleGenerativeAI({ model: "gemma-4-31b-it", temperature: 0 });
        case 'ollama':
            return new ChatOllama({ baseUrl: "http://localhost:11434", model: "qwen2.5:latest", temperature: 0 });
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

// --- 2. DEFINIZIONE DEI TOOL TRAMITE ZOD ---
const webActionSchema = z.object({
    action: z.enum(["click", "fill", "select", "done"]).describe("L'azione da eseguire sul browser."),
    agentId: z.string().optional().describe("L'ID dell'elemento target (es. 'agent-el-12'). Non serve per 'done'."),
    value: z.string().optional().describe("Il valore da inserire (per 'fill') o da selezionare (per 'select')."),
    reasoning: z.string().describe("La spiegazione logica dietro a questa specifica azione.")
}).describe("Esegue un'azione guidata sulla pagina web corrente sulla base dell'AST analizzato.");

// --- 3. STATO DEL GRAFO (LangGraph Moderno) ---
const AgentStateDef = Annotation.Root({
    objective: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
    currentUrl: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
    domAst: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
    lastToolCall: Annotation<any>({ reducer: (x, y) => y ?? x, default: () => null }),
    isFinished: Annotation<boolean>({ reducer: (x, y) => y ?? x, default: () => false }),
});

type AgentState = typeof AgentStateDef.State;

// --- 4. ESTRAZIONE AST SEMPLIFICATO (Playwright) ---
async function extractSimplifiedDOM(page: Page): Promise<string> {
    return await page.evaluate(() => {
        let counter = 0;
        const elements: any[] = [];
        const interactables = document.querySelectorAll('a, button, input, select, textarea, [role="button"]');
        
        interactables.forEach((el) => {
            const id = `agent-el-${counter++}`;
            el.setAttribute('data-agent-id', id);
            
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;

            elements.push({
                agentId: id,
                tag: el.tagName.toLowerCase(),
                text: (el as HTMLElement).innerText?.trim() || '',
                value: (el as HTMLInputElement).value || '',
                type: el.getAttribute('type') || undefined,
                name: el.getAttribute('name') || undefined,
                placeholder: el.getAttribute('placeholder') || undefined,
            });
        });
        
        return JSON.stringify(elements, null, 2);
    });
}

// --- 5. INIZIALIZZAZIONE SICURA DEL MODELLO E DEI TOOL ---
const baseLlm = getLLM('google'); // Scegli qui il provider preferito

// Controllo di tipo a runtime per soddisfare strictNullChecks e verificare il supporto al tool calling
if (typeof baseLlm.bindTools !== "function") {
    throw new Error(`Il provider selezionato non supporta nativamente il tool calling.`);
}

const llmWithTools = baseLlm.bindTools([{
    name: "execute_web_action",
    description: "Esegue un'azione sulla pagina web basandosi sugli ID dell'AST fornito.",
    schema: webActionSchema
}]);

// --- 6. NODI DEL GRAFO ---
let browser: Browser;
let page: Page;

async function observeNode(state: AgentState): Promise<Partial<AgentState>> {
    console.log("-> [Observe] Analisi del DOM corrente...");
    await page.waitForLoadState("networkidle");
    const currentUrl = page.url();
    const domAst = await extractSimplifiedDOM(page);
    
    return { currentUrl, domAst };
}

async function decideNode(state: AgentState): Promise<Partial<AgentState>> {
    console.log("-> [Decide] L'LLM sta scegliendo il tool da invocare...");
    
    const prompt = `Sei un agente di automazione web autonomo.
Il tuo obiettivo finale è: ${state.objective}
Ti trovi attualmente all'URL: ${state.currentUrl}

Ecco l'AST semplificato degli elementi interattivi presenti nella pagina:
${state.domAst}

Analizza l'AST e invoca lo strumento 'execute_web_action' per decidere il prossimo step.`;

    const response = await llmWithTools.invoke([new HumanMessage(prompt)]);
    
    const toolCalls = response.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
        const toolCall = toolCalls[0];
        if (toolCall) {
            console.log(`Tool selezionato: ${toolCall.name} con argomenti:`, toolCall.args);
            return { lastToolCall: toolCall.args };
        }
    }
    
    console.warn("L'LLM non ha invocato il tool nativo o ha terminato in autonomia.");
    return { isFinished: true };
}

async function executeNode(state: AgentState): Promise<Partial<AgentState>> {
    const decision = state.lastToolCall;
    if (!decision) {
        return { isFinished: true };
    }
    
    console.log(`-> [Execute] Azione: ${decision.action} su ID: ${decision.agentId ?? 'N/A'} (Motivazione: ${decision.reasoning})`);

    if (decision.action === 'done') {
        return { isFinished: true };
    }

    try {
        const locator = page.locator(`[data-agent-id="${decision.agentId}"]`);
        await locator.waitFor({ state: "attached", timeout: 5000 });

        switch (decision.action) {
            case 'click':
                await locator.click();
                break;
            case 'fill':
                await locator.fill(decision.value || "");
                break;
            case 'select':
                await locator.selectOption(decision.value || "");
                break;
            default:
                console.log("Azione sconosciuta o non gestita.");
        }
    } catch (e: any) {
        console.error(`Errore durante l'interazione sul browser: ${e.message}`);
    }

    return { isFinished: false, lastToolCall: null };
}

// --- 7. COSTRUZIONE E COMPILAZIONE DEL GRAFO ---
const workflow = new StateGraph(AgentStateDef)
    .addNode("observe", observeNode)
    .addNode("decide", decideNode)
    .addNode("execute", executeNode)
    .addEdge(START, "observe")
    .addEdge("observe", "decide")
    .addEdge("decide", "execute")
    .addConditionalEdges("execute", (state) => state.isFinished ? END : "observe");

const app = workflow.compile();

// --- 8. APERTURA BROWSER ED ESECUZIONE ---
async function run() {
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    page = await context.newPage();
    
    await page.goto("https://www.wikipedia.org/");

    const initialState = {
        objective: "Seleziona la lingua 'Italiano' dal menu a tendina delle lingue principali, poi digita 'Reggio Emilia' nella barra di ricerca ed esegui la ricerca.",
        currentUrl: "",
        domAst: "",
        lastToolCall: null,
        isFinished: false
    };

    console.log("Avvio del flusso con Native Tool Calling...");
    await app.invoke(initialState, { recursionLimit: 20 });
    
    console.log("Flusso terminato con successo.");
    await browser.close();
}

run().catch(console.error);