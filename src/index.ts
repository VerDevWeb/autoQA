import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { z } from "zod";
import * as dotenv from "dotenv";
import { getLLM } from "./modelController.js";

dotenv.config();

// --- 2. DEFINIZIONE DEI TOOL TRAMITE ZOD ---
const webActionSchema = z.object({
    action: z.enum(["click", "fill", "select", "enter", "goto", "done"]).describe("L'azione da eseguire sul browser. Usa 'enter' per premere Invio e 'goto' per navigare a un URL."),
    agentId: z.string().optional().describe("L'ID dell'elemento target (es. 'agent-el-12'). Non serve per 'done' e 'goto'. Per 'enter' e' opzionale se l'elemento e' gia' in focus."),
    value: z.string().optional().describe("Il valore da inserire (per 'fill') o da selezionare (per 'select')."),
    url: z.string().url().optional().describe("URL di destinazione da usare quando action='goto'."),
    reasoning: z.string().describe("La spiegazione logica dietro a questa specifica azione.")
}).describe("Esegue un'azione guidata sulla pagina web corrente sulla base dell'AST analizzato.");

// --- 3. STATO DEL GRAFO (LangGraph Moderno) ---
const AgentStateDef = Annotation.Root({
    objective: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
    currentUrl: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
    domAst: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
    lastToolCall: Annotation<any>({ reducer: (x, y) => y ?? x, default: () => null }),
    actionHistory: Annotation<string[]>({ reducer: (x, y) => y ?? x, default: () => [] }),
    noToolCallStreak: Annotation<number>({ reducer: (x, y) => y ?? x, default: () => 0 }),
    isFinished: Annotation<boolean>({ reducer: (x, y) => y ?? x, default: () => false }),
});

type AgentState = typeof AgentStateDef.State;

// --- 4. ESTRAZIONE AST AD ALTA FEDELTÀ (Playwright) ---
async function extractSimplifiedDOM(page: Page): Promise<string> {
    return await page.evaluate(() => {
        let counter = 0;
        const elements: any[] = [];
        const selector = 'a, button, input, select, textarea, [role="button"], [onclick], [cursor="pointer"]';
        const interactables = document.querySelectorAll(selector);

        interactables.forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

            const id = `agent-el-${counter++}`;
            el.setAttribute('data-agent-id', id);

            const attributes: Record<string, string> = {};
            for (let i = 0; i < el.attributes.length; i++) {
                const attr = el.attributes[i];
                if (attr && attr.name !== 'data-agent-id') {
                    attributes[attr.name] = attr.value;
                }
            }

            let visualText = (el as HTMLElement).innerText?.trim() || '';
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                visualText = (el as HTMLInputElement).value || el.getAttribute('placeholder') || '';
            }

            elements.push({
                agentId: id,
                tagName: el.tagName.toLowerCase(),
                text: visualText,
                attributes: attributes
            });
        });

        return JSON.stringify(elements, null, 2);
    });
}

// --- 5. INIZIALIZZAZIONE SICURA DEL MODELLO E DEI TOOL ---
const baseLlm = getLLM('ollama'); // Scegli qui il provider preferito

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
    await Promise.race([
        page.waitForLoadState("load"),
        new Promise(resolve => setTimeout(resolve, 3000))
    ]);
    const currentUrl = page.url();
    const domAst = await extractSimplifiedDOM(page);

    console.log(`\n--- AST (${currentUrl}) ---\n${domAst}\n--- FINE AST ---\n`);

    return { currentUrl, domAst };
}

async function decideNode(state: AgentState): Promise<Partial<AgentState>> {
    console.log("-> [Decide] L'LLM sta scegliendo il tool da invocare...");

    const historyBlock = state.actionHistory.length > 0
        ? `\nAzioni già eseguite (NON ripetere queste):\n${state.actionHistory.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n`
        : '';

    const prompt = `Sei un agente di automazione web autonomo.
        Il tuo obiettivo finale è: ${state.objective}
        Ti trovi attualmente all'URL: ${state.currentUrl}
        ${historyBlock}
        Ecco l'AST ad alta fedeltà degli elementi interattivi presenti nella pagina:
        ${state.domAst}

Analizza l'AST e invoca lo strumento 'execute_web_action' per decidere il PROSSIMO step non ancora eseguito.`;

    const response = await llmWithTools.invoke([new HumanMessage(prompt)]);

    const toolCalls = response.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
        const toolCall = toolCalls[0];
        if (toolCall) {
            console.log(`Tool selezionato: ${toolCall.name} con argomenti:`, toolCall.args);
            return { lastToolCall: toolCall.args, noToolCallStreak: 0 };
        }
    }

    const nextNoToolCallStreak = state.noToolCallStreak + 1;
    console.warn(`L'LLM non ha invocato tool (tentativo ${nextNoToolCallStreak}/3).`);
    if (nextNoToolCallStreak >= 3) {
        return { isFinished: true, noToolCallStreak: nextNoToolCallStreak };
    }

    return { isFinished: false, lastToolCall: null, noToolCallStreak: nextNoToolCallStreak };
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

    if (decision.action === 'goto') {
        const targetUrl = decision.url || decision.value;
        if (!targetUrl) {
            console.error("Azione 'goto' senza URL.");
            return { isFinished: false, lastToolCall: null };
        }

        try {
            await page.goto(targetUrl);
        } catch (e: any) {
            console.error(`Errore durante la navigazione verso ${targetUrl}: ${e.message}`);
        }

        return { isFinished: false, lastToolCall: null };
    }

    try {
        switch (decision.action) {
            case 'click':
                if (!decision.agentId) throw new Error("Azione 'click' richiede agentId.");
                {
                    const locator = page.locator(`[data-agent-id="${decision.agentId}"]`);
                    await locator.waitFor({ state: "attached", timeout: 5000 });
                    await locator.click();
                }
                break;
            case 'fill':
                if (!decision.agentId) throw new Error("Azione 'fill' richiede agentId.");
                {
                    const locator = page.locator(`[data-agent-id="${decision.agentId}"]`);
                    await locator.waitFor({ state: "attached", timeout: 5000 });
                    await locator.fill(decision.value || "");
                }
                break;
            case 'select':
                if (!decision.agentId) throw new Error("Azione 'select' richiede agentId.");
                {
                    const locator = page.locator(`[data-agent-id="${decision.agentId}"]`);
                    await locator.waitFor({ state: "attached", timeout: 5000 });
                    await locator.selectOption(decision.value || "");
                }
                break;
            case 'enter':
                // Non bloccare Enter su waitFor: su DOM dinamico (autocomplete) l'ID può cambiare.
                // Se possibile focalizza rapidamente l'elemento, poi invia Enter alla tastiera.
                if (decision.agentId) {
                    try {
                        const locator = page.locator(`[data-agent-id="${decision.agentId}"]`);
                        await locator.focus({ timeout: 2000 });
                    } catch {
                        // elemento non più trovabile, il focus è già sul campo giusto
                    }
                }
                await page.keyboard.press('Enter');
                break;
            default:
                console.log("Azione sconosciuta o non gestita.");
        }
    } catch (e: any) {
        console.error(`Errore durante l'interazione sul browser: ${e.message}`);
    }

    const historyEntry = `${decision.action}${decision.agentId ? ` su ${decision.agentId}` : ''}${decision.value ? ` con valore "${decision.value}"` : ''}${decision.url ? ` verso ${decision.url}` : ''}`;
    return { isFinished: false, lastToolCall: null, actionHistory: [...state.actionHistory, historyEntry] };
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
        objective: "Seleziona la lingua 'Italiano' dal menu a tendina delle lingue principali, poi digita 'Reggio Emilia' nella barra di ricerca ed esegui la ricerca premendo Invio.",
        currentUrl: "",
        domAst: "",
        lastToolCall: null,
        actionHistory: [],
        noToolCallStreak: 0,
        isFinished: false
    };

    console.log("Avvio del flusso con Native Tool Calling...");
    await app.invoke(initialState, { recursionLimit: 20 });

    console.log("Flusso terminato con successo.");
    // await browser.close();
}

run().catch(console.error);