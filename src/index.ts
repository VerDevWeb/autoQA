import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { chromium } from "playwright";
import type { Browser, Page, Locator } from "playwright";
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

type AstElement = {
    agentId: string;
    tagName: string;
    text: string;
    attributes: Record<string, string>;
};

// --- 4. ESTRAZIONE AST AD ALTA FEDELTÀ (Playwright) ---
async function extractSimplifiedDOM(page: Page): Promise<string> {
    return await page.evaluate(() => {
        let counter = 0;
        const elements: any[] = [];
        const selector = 'a, button, input, select, textarea, [role="button"], [onclick], [cursor="pointer"]';
        const interactables = document.querySelectorAll(selector);

        const bodyText = document.body?.innerText || '';
        const bodyWords = bodyText.trim() ? bodyText.trim().split(/\s+/).length : 0;
        const compactMode = bodyWords > 1200;
        const maxWordsPerElement = 20;

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

            if (compactMode) {
                const clean = visualText.replace(/\s+/g, ' ').trim();
                if (clean) {
                    const words = clean.split(' ');
                    visualText = words.length <= maxWordsPerElement
                        ? clean
                        : `${words.slice(0, maxWordsPerElement).join(' ')} ...`;
                } else {
                    visualText = '';
                }
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

function parseDomAst(domAst: string): AstElement[] {
    try {
        const parsed = JSON.parse(domAst);
        if (!Array.isArray(parsed)) return [];
        return parsed as AstElement[];
    } catch {
        return [];
    }
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeCompactText(value: string): string {
    return value.replace(/[\r\n|]/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildCompactAstForPrompt(domAst: string): string {
    const elements = parseDomAst(domAst);
    if (elements.length === 0) {
        return "";
    }

    // Formato ultra-compatto: una riga per elemento, niente graffe/chiavi ripetute JSON.
    return elements.map((el) => {
        const txt = sanitizeCompactText(el.text || "").slice(0, 180);
        const attr = el.attributes || {};

        const extras: string[] = [];
        const type = sanitizeCompactText(attr.type || "");
        const role = sanitizeCompactText(attr.role || "");
        const placeholder = sanitizeCompactText(attr.placeholder || "").slice(0, 80);
        const ariaLabel = sanitizeCompactText(attr["aria-label"] || "").slice(0, 80);
        const name = sanitizeCompactText(attr.name || "").slice(0, 60);

        if (type) extras.push(`t=${type}`);
        if (role) extras.push(`r=${role}`);
        if (placeholder) extras.push(`ph=${placeholder}`);
        if (ariaLabel) extras.push(`aria=${ariaLabel}`);
        if (name) extras.push(`n=${name}`);

        const extrasBlock = extras.length > 0 ? `|${extras.join("|")}` : "";
        return `${el.agentId}|${el.tagName}|${txt}${extrasBlock}`;
    }).join("\n");
}

async function resolveLocatorWithFallback(state: AgentState, agentId: string): Promise<Locator> {
    const primary = page.locator(`[data-agent-id="${agentId}"]`);
    if (await primary.count() > 0) {
        return primary.first();
    }

    const astElements = parseDomAst(state.domAst);
    const target = astElements.find((el) => el.agentId === agentId);
    if (!target) {
        throw new Error(`Elemento ${agentId} non trovato nell'AST corrente.`);
    }

    const normalizedText = (target.text || '').replace(/\s+/g, ' ').trim();
    if (normalizedText.length >= 3) {
        const textRegex = new RegExp(escapeRegex(normalizedText), 'i');
        const byContains = page.locator(target.tagName).filter({ hasText: textRegex });
        if (await byContains.count() > 0) {
            return byContains.first();
        }
    }

    const placeholder = target.attributes?.placeholder;
    if (placeholder) {
        const byPlaceholder = page.getByPlaceholder(placeholder, { exact: false });
        if (await byPlaceholder.count() > 0) {
            return byPlaceholder.first();
        }
    }

    const ariaLabel = target.attributes?.["aria-label"];
    if (ariaLabel) {
        const byLabel = page.getByLabel(ariaLabel, { exact: false });
        if (await byLabel.count() > 0) {
            return byLabel.first();
        }
    }

    throw new Error(`Impossibile risolvere il locator per ${agentId} (ID non più valido e fallback testuale fallito).`);
}

function isContextDestroyedError(error: unknown): boolean {
    const message = (error as Error)?.message ?? String(error);
    return message.includes("Execution context was destroyed")
        || message.includes("Cannot find context with specified id")
        || message.includes("Most likely the page has been closed");
}

async function extractSimplifiedDOMWithRetry(page: Page, maxAttempts = 4): Promise<string> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await page.waitForLoadState("domcontentloaded", { timeout: 4000 }).catch(() => undefined);
            return await extractSimplifiedDOM(page);
        } catch (error) {
            if (!isContextDestroyedError(error) || attempt === maxAttempts) {
                throw error;
            }

            // Se una navigazione è in corso, aspetta un attimo e riprova.
            await page.waitForLoadState("domcontentloaded", { timeout: 4000 }).catch(() => undefined);
            await new Promise(resolve => setTimeout(resolve, 250));
        }
    }

    throw new Error("Impossibile estrarre il DOM dopo più tentativi.");
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

let llmIterationCounter = 0;
let totalEstimatedInputTokens = 0;
let totalReportedInputTokens = 0;

function estimateInputTokens(text: string): number {
    // Stima veloce: circa 1 token ogni 4 caratteri per testi latini.
    return Math.ceil(text.length / 4);
}

function getReportedInputTokens(response: any): number | null {
    const usage = response?.usage_metadata ?? response?.response_metadata?.tokenUsage ?? response?.response_metadata?.usage;
    if (!usage) return null;

    const candidate = usage.input_tokens
        ?? usage.prompt_tokens
        ?? usage.inputTokenCount
        ?? usage.promptTokenCount;

    return typeof candidate === "number" ? candidate : null;
}

function logSessionTokenSummary(): void {
    console.log("\n=== SESSION TOKEN SUMMARY ===");
    console.log(`[LLM] Iterazioni totali: ${llmIterationCounter}`);
    console.log(`[LLM] Input stimati totali: ${totalEstimatedInputTokens} token`);
    if (totalReportedInputTokens > 0) {
        console.log(`[LLM] Input reali totali (provider): ${totalReportedInputTokens} token`);
    } else {
        console.log("[LLM] Input reali totali (provider): n/d (provider non ha restituito usage metadata)");
    }
    console.log("=== FINE SESSION TOKEN SUMMARY ===\n");
}

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
    const domAst = await extractSimplifiedDOMWithRetry(page);

    // console.log(`\n--- AST (${currentUrl}) ---\n${domAst}\n--- FINE AST ---\n`);

    return { currentUrl, domAst };
}

async function decideNode(state: AgentState): Promise<Partial<AgentState>> {
    console.log("-> [Decide] L'LLM sta scegliendo il tool da invocare...");

    const historyBlock = state.actionHistory.length > 0
        ? `\nAzioni già eseguite (NON ripetere queste):\n${state.actionHistory.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n`
        : '';

    const compactAstForPrompt = buildCompactAstForPrompt(state.domAst);

    const prompt = `Sei un agente di automazione web autonomo.
        Il tuo obiettivo finale è: ${state.objective}
        Ti trovi attualmente all'URL: ${state.currentUrl}
        ${historyBlock}
        Ecco l'AST COMPACT degli elementi interattivi (formato: agentId|tag|text|attributi):
        ${compactAstForPrompt}

Analizza l'AST e invoca lo strumento 'execute_web_action' per decidere il PROSSIMO step non ancora eseguito.`;

    llmIterationCounter += 1;
    const estimatedInputTokens = estimateInputTokens(prompt);
    totalEstimatedInputTokens += estimatedInputTokens;
    console.log(
        `[LLM] Iterazione ${llmIterationCounter} | Input stimati: ${estimatedInputTokens} token | Totale stimati: ${totalEstimatedInputTokens}`
    );

    const response = await llmWithTools.invoke([new HumanMessage(prompt)]);
    const reportedInputTokens = getReportedInputTokens(response);
    if (reportedInputTokens !== null) {
        totalReportedInputTokens += reportedInputTokens;
        console.log(
            `[LLM] Iterazione ${llmIterationCounter} | Input reali (provider): ${reportedInputTokens} token | Totale reali: ${totalReportedInputTokens}`
        );
    }

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
                    const locator = await resolveLocatorWithFallback(state, decision.agentId);
                    await locator.waitFor({ state: "attached", timeout: 5000 });
                    await locator.click();
                }
                break;
            case 'fill':
                if (!decision.agentId) throw new Error("Azione 'fill' richiede agentId.");
                {
                    const locator = await resolveLocatorWithFallback(state, decision.agentId);
                    await locator.waitFor({ state: "attached", timeout: 5000 });
                    await locator.fill(decision.value || "");
                }
                break;
            case 'select':
                if (!decision.agentId) throw new Error("Azione 'select' richiede agentId.");
                {
                    const locator = await resolveLocatorWithFallback(state, decision.agentId);
                    await locator.waitFor({ state: "attached", timeout: 5000 });
                    await locator.selectOption(decision.value || "");
                }
                break;
            case 'enter':
                // Non bloccare Enter su waitFor: su DOM dinamico (autocomplete) l'ID può cambiare.
                // Se possibile focalizza rapidamente l'elemento, poi invia Enter alla tastiera.
                if (decision.agentId) {
                    try {
                        const locator = await resolveLocatorWithFallback(state, decision.agentId);
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
    try {
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
    } finally {
        logSessionTokenSummary();
        // await browser?.close();
    }
}

run().catch(console.error);