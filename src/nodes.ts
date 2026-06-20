import type { Page } from "playwright";
import type { AgentState } from "./types.js";
import { HumanMessage } from "@langchain/core/messages";
<<<<<<< HEAD
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { extractSimplifiedDOMWithRetry, parseDomElements } from "./ast.js";
import { extractObjectiveDomains, findNextTargetDomain, getDomainFromUrl, domainsMatch, upsertDomainStatus, tryMarkCompletedDomain, isConsentLikeElement, isYoutubeResultLikeElement, } from "./domains.js";
import { resolveLocator } from "./locators.js";
=======
import { extractSimplifiedDOMWithRetry, buildCompactAstForPrompt, parseDomAst } from "./ast.js";
import {
    extractObjectiveDomains,
    findNextTargetDomain,
    getDomainFromUrl,
    domainsMatch,
    upsertDomainStatus,
    tryMarkCompletedDomain,
    isConsentLikeElement,
    isYoutubeResultLikeElement,
} from "./domains.js";
import { resolveLocatorWithFallback } from "./locators.js";
>>>>>>> 9afb263 (code refactor => divided index.ts into single files, each file's function or content is explained in the README.ts)
import {
    incrementIterationCounter,
    estimateInputTokens,
    getReportedInputTokens,
    recordIterationTokens,
    llmIterationCounter,
} from "./tokens.js";

let currentPage: Page;

<<<<<<< HEAD
async function logLlmInput(payload: Record<string, unknown>): Promise<void> {
    const logDir = path.join(process.cwd(), "logs");
    const logFile = path.join(logDir, "llm-input.jsonl");

    try {
        await mkdir(logDir, { recursive: true });
        await appendFile(logFile, `${JSON.stringify(payload)}\n`, "utf8");
    } catch (error: any) {
        console.warn(`[Decide] Impossibile salvare input LLM su file: ${error?.message ?? error}`);
    }
}

async function logAstToFile(ast: string, iteration: number): Promise<void> {
    const astDir = path.join(process.cwd(), "logs", "ast");
    const ts = new Date().toISOString().replace(/:/g, "-").replace(/\./g, "-");
    const filePath = path.join(astDir, `ast-${ts}-iter-${iteration}.txt`);

    try {
        await mkdir(astDir, { recursive: true });
        await appendFile(filePath, ast, "utf8");
    } catch (error: any) {
        console.warn(`[Decide] Impossibile salvare AST su file: ${error?.message ?? error}`);
    }
}

=======
>>>>>>> 9afb263 (code refactor => divided index.ts into single files, each file's function or content is explained in the README.ts)
export function setPageForNodes(page: Page): void {
    currentPage = page;
}

export async function observeNode(state: AgentState): Promise<Partial<AgentState>> {
<<<<<<< HEAD
    await sleep(500);
=======
>>>>>>> 9afb263 (code refactor => divided index.ts into single files, each file's function or content is explained in the README.ts)
    console.log("-> [Observe] Analisi del DOM corrente...");
    await Promise.race([
        currentPage.waitForLoadState("load"),
        new Promise(resolve => setTimeout(resolve, 3000))
    ]);
    const currentUrl = currentPage.url();
<<<<<<< HEAD
    const result = await extractSimplifiedDOMWithRetry(currentPage);

    return { currentUrl, domAst: result.tree, domElements: JSON.stringify(result.elements) };
=======
    const domAst = await extractSimplifiedDOMWithRetry(currentPage);

    return { currentUrl, domAst };
>>>>>>> 9afb263 (code refactor => divided index.ts into single files, each file's function or content is explained in the README.ts)
}

export async function decideNode(
    state: AgentState,
    llmWithTools: any
): Promise<Partial<AgentState>> {
<<<<<<< HEAD
    await sleep(500);
=======
>>>>>>> 9afb263 (code refactor => divided index.ts into single files, each file's function or content is explained in the README.ts)
    console.log("-> [Decide] L'LLM sta scegliendo il tool da invocare...");

    const objectiveDomains = extractObjectiveDomains(state.objective);
    const nextTargetDomain = findNextTargetDomain(objectiveDomains, state.completedDomains);

    if (objectiveDomains.length > 0 && nextTargetDomain === null) {
<<<<<<< HEAD
        console.log("[Decide] Tutti i domini dell'obiettivo visitati — l'LLM deciderà se proseguire o chiamare done.");
    }

    const historyBlock = state.actionHistory.length > 0
        ? `\nActions already executed (DO NOT repeat):\n${state.actionHistory.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n`
        : '';

    const sequenceBlock = objectiveDomains.length > 0
        ? `\nObjective domains in order: ${objectiveDomains.join(" -> ")}\nCompleted domains: ${state.completedDomains.length > 0 ? state.completedDomains.join(", ") : "none"}\nNext target domain: ${nextTargetDomain ?? "none"}\n`
        : "";

    const progressBlock = state.progress
        ? `\n📋 YOUR PROGRESS CHECKPOINT (what you wrote last time):\n${state.progress}\n`
        : "";

    console.log("--- DOM TREE (che vede l'LLM) ---\n" + state.domAst + "\n--- END TREE ---");

    const prompt = `You are an autonomous web automation agent.
Your final objective is: ${state.objective}
You are currently at URL: ${state.currentUrl}
${historyBlock}
${sequenceBlock}
${progressBlock}
Here is the DOM tree of the page (indented = hierarchy, tag#id.class[attrs] text):
${state.domAst}

To interact, invoke 'execute_web_action' with:
- tag: the HTML tag (e.g. 'a', 'button', 'input')
- text: the visible text of the element
- attrs: key identifying attributes (e.g. {"href": "/wiki/Ferrari", "placeholder": "Cerca"})
For 'click', 'fill', 'select' you MUST provide tag + enough info to locate the element.
For 'goto' provide the URL.
Call 'done' ONLY when the entire objective is complete.`;

    const reinforcedPrompt = `${prompt}

Operating rules:
- If you are not on the correct page yet, or the current URL is empty/not relevant, immediately use action='goto'.
- Do not repeat actions already present in history.`;

    const sequenceRule = nextTargetDomain
        ? `\n- Use action='goto' only toward the next target domain: ${nextTargetDomain}. Do not return to already completed domains.`
=======
        console.log("[Decide] Tutti i domini dell'obiettivo risultano completati.");
        return { isFinished: true, lastToolCall: null };
    }

    const historyBlock = state.actionHistory.length > 0
        ? `\nAzioni già eseguite (NON ripetere queste):\n${state.actionHistory.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n`
        : '';

    const sequenceBlock = objectiveDomains.length > 0
        ? `\nDomini obiettivo in ordine: ${objectiveDomains.join(" -> ")}\nDomini completati: ${state.completedDomains.length > 0 ? state.completedDomains.join(", ") : "nessuno"}\nProssimo dominio target: ${nextTargetDomain ?? "nessuno"}\n`
        : "";

    const compactAstForPrompt = buildCompactAstForPrompt(state.domAst);

    const prompt = `Sei un agente di automazione web autonomo.
        Il tuo obiettivo finale è: ${state.objective}
        Ti trovi attualmente all'URL: ${state.currentUrl}
        ${historyBlock}
        ${sequenceBlock}
        Ecco l'AST COMPACT degli elementi interattivi (formato: agentId|tag|text|attributi):
        ${compactAstForPrompt}

Analizza l'AST e invoca lo strumento 'execute_web_action' per decidere il PROSSIMO step non ancora eseguito.`;
    
    const reinforcedPrompt = `${prompt}

Regole operative:
- Se non sei ancora sulla pagina giusta o l'URL corrente e' vuoto/non pertinente, usa subito action='goto' con un URL completo (https://...).
- Non ripetere azioni gia' presenti nello storico.`;
    
    const sequenceRule = nextTargetDomain
        ? `\n- Usa action='goto' solo verso il prossimo dominio target: ${nextTargetDomain}. Non tornare ai domini gia' completati.`
>>>>>>> 9afb263 (code refactor => divided index.ts into single files, each file's function or content is explained in the README.ts)
        : "";

    const finalPrompt = `${reinforcedPrompt}${sequenceRule}`;

    incrementIterationCounter();
    const estimatedInputTokens = estimateInputTokens(finalPrompt);
<<<<<<< HEAD
    const llmMessages = [new HumanMessage(finalPrompt)];

    await logLlmInput({
        timestamp: new Date().toISOString(),
        iteration: llmIterationCounter,
        currentUrl: state.currentUrl,
        objective: state.objective,
        messages: llmMessages.map((msg) => ({
            role: "user",
            content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
        }))
    });

    await logAstToFile(finalPrompt, llmIterationCounter);

    const response = await llmWithTools.invoke(llmMessages);
=======
    
    const response = await llmWithTools.invoke([new HumanMessage(finalPrompt)]);
>>>>>>> 9afb263 (code refactor => divided index.ts into single files, each file's function or content is explained in the README.ts)
    const reportedInputTokens = getReportedInputTokens(response);
    recordIterationTokens(estimatedInputTokens, reportedInputTokens, llmIterationCounter);

    const toolCalls = response.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
        const toolCall = toolCalls[0];
        if (toolCall) {
            console.log(`Tool selezionato: ${toolCall.name} con argomenti:`, toolCall.args);
<<<<<<< HEAD
            const progress = toolCall.args?.progress || state.progress;
            return { lastToolCall: toolCall.args, noToolCallStreak: 0, progress };
=======
            return { lastToolCall: toolCall.args, noToolCallStreak: 0 };
>>>>>>> 9afb263 (code refactor => divided index.ts into single files, each file's function or content is explained in the README.ts)
        }
    }

    const nextNoToolCallStreak = state.noToolCallStreak + 1;
    console.warn(`L'LLM non ha invocato tool (tentativo ${nextNoToolCallStreak}/3).`);
    if (nextNoToolCallStreak >= 3) {
        return { isFinished: true, lastToolCall: null, noToolCallStreak: nextNoToolCallStreak };
    }

    return { isFinished: false, lastToolCall: null, noToolCallStreak: nextNoToolCallStreak };
}

export async function executeNode(state: AgentState): Promise<Partial<AgentState>> {
<<<<<<< HEAD
    await sleep(500);
=======
>>>>>>> 9afb263 (code refactor => divided index.ts into single files, each file's function or content is explained in the README.ts)
    if (state.isFinished) {
        return { isFinished: true, lastToolCall: null };
    }

    const decision = state.lastToolCall;
    if (!decision) {
        return { isFinished: true, lastToolCall: null };
    }

<<<<<<< HEAD
    console.log(`-> [Execute] Azione: ${decision.action} su <${decision.tag ?? '?'}> "${decision.text ?? ''}" (${decision.reasoning})`);
=======
    console.log(`-> [Execute] Azione: ${decision.action} su ID: ${decision.agentId ?? 'N/A'} (Motivazione: ${decision.reasoning})`);
>>>>>>> 9afb263 (code refactor => divided index.ts into single files, each file's function or content is explained in the README.ts)

    if (decision.action === 'done') {
        return { isFinished: true, lastToolCall: null };
    }

    if (decision.action === 'goto') {
        const targetUrl = decision.url || decision.value;
        if (!targetUrl) {
            console.error("Azione 'goto' senza URL.");
            return { isFinished: false, lastToolCall: null };
        }

        const objectiveDomains = extractObjectiveDomains(state.objective);
        const nextTargetDomain = findNextTargetDomain(objectiveDomains, state.completedDomains);
        const targetDomain = getDomainFromUrl(targetUrl);

        if (nextTargetDomain && targetDomain && !domainsMatch(targetDomain, nextTargetDomain)) {
            const blocked = `goto bloccato verso ${targetDomain} (atteso: ${nextTargetDomain})`;
            console.warn(`[GuardRail] ${blocked}`);
            return {
                isFinished: false,
                lastToolCall: null,
                actionHistory: [...state.actionHistory, blocked]
            };
        }

        if (targetDomain && state.completedDomains.some((d) => domainsMatch(d, targetDomain)) && nextTargetDomain) {
            const blocked = `goto bloccato verso dominio già completato: ${targetDomain}`;
            console.warn(`[GuardRail] ${blocked}`);
            return {
                isFinished: false,
                lastToolCall: null,
                actionHistory: [...state.actionHistory, blocked]
            };
        }

        try {
            await currentPage.goto(targetUrl);
        } catch (e: any) {
            console.error(`Errore durante la navigazione verso ${targetUrl}: ${e.message}`);
        }

        return { isFinished: false, lastToolCall: null };
    }

    let updatedDomainStatus = state.domainStatus;
    let updatedCompletedDomains = state.completedDomains;

    try {
<<<<<<< HEAD
        const locator = decision.tag
            ? await resolveLocator(decision.tag, decision.text, decision.attrs)
            : null;

        switch (decision.action) {
            case 'click': {
                if (!locator) throw new Error("Azione 'click' richiede tag.");

                const elements = parseDomElements(state.domElements);
                const clickTarget = elements.find((el) =>
                    el.tagName === decision.tag &&
                    el.text === decision.text
                );

                await locator.waitFor({ state: "attached", timeout: 5000 });
                await locator.click();

                const domain = getDomainFromUrl(currentPage.url());
                const consentClick = isConsentLikeElement(clickTarget);
                const resultLikeClick = domain.includes("youtube.")
                    ? isYoutubeResultLikeElement(clickTarget) && !consentClick
                    : !consentClick;

                updatedDomainStatus = upsertDomainStatus(updatedDomainStatus, domain, (prev) => ({
                    ...prev,
                    clicked: true,
                    clickedResult: prev.clickedResult || resultLikeClick,
                    cookieHandled: prev.cookieHandled || consentClick
                }));
                updatedCompletedDomains = tryMarkCompletedDomain(state.objective, domain, updatedDomainStatus, updatedCompletedDomains);
                break;
            }
            case 'fill': {
                if (!locator) throw new Error("Azione 'fill' richiede tag.");
                await locator.waitFor({ state: "attached", timeout: 5000 });
                await locator.fill(decision.value || "");

                const domain = getDomainFromUrl(currentPage.url());
                updatedDomainStatus = upsertDomainStatus(updatedDomainStatus, domain, (prev) => ({
                    ...prev,
                    filled: true
                }));
                break;
            }
            case 'select': {
                if (!locator) throw new Error("Azione 'select' richiede tag.");
                await locator.waitFor({ state: "attached", timeout: 5000 });
                await locator.selectOption(decision.value || "");
                break;
            }
            case 'enter':
                if (locator) {
                    try {
=======
        switch (decision.action) {
            case 'click':
                if (!decision.agentId) throw new Error("Azione 'click' richiede agentId.");
                {
                    const clickTarget = parseDomAst(state.domAst).find((el) => el.agentId === decision.agentId);
                    const locator = await resolveLocatorWithFallback(state, decision.agentId);
                    await locator.waitFor({ state: "attached", timeout: 5000 });
                    await locator.click();

                    const domain = getDomainFromUrl(currentPage.url());
                    const consentClick = isConsentLikeElement(clickTarget);
                    const resultLikeClick = domain.includes("youtube.")
                        ? isYoutubeResultLikeElement(clickTarget) && !consentClick
                        : !consentClick;

                    updatedDomainStatus = upsertDomainStatus(updatedDomainStatus, domain, (prev) => ({
                        ...prev,
                        clicked: true,
                        clickedResult: prev.clickedResult || resultLikeClick,
                        cookieHandled: prev.cookieHandled || consentClick
                    }));
                    updatedCompletedDomains = tryMarkCompletedDomain(state.objective, domain, updatedDomainStatus, updatedCompletedDomains);
                }
                break;
            case 'fill':
                if (!decision.agentId) throw new Error("Azione 'fill' richiede agentId.");
                {
                    const locator = await resolveLocatorWithFallback(state, decision.agentId);
                    await locator.waitFor({ state: "attached", timeout: 5000 });
                    await locator.fill(decision.value || "");

                    const domain = getDomainFromUrl(currentPage.url());
                    updatedDomainStatus = upsertDomainStatus(updatedDomainStatus, domain, (prev) => ({
                        ...prev,
                        filled: true
                    }));
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
                if (decision.agentId) {
                    try {
                        const locator = await resolveLocatorWithFallback(state, decision.agentId);
>>>>>>> 9afb263 (code refactor => divided index.ts into single files, each file's function or content is explained in the README.ts)
                        await locator.focus({ timeout: 2000 });
                    } catch {
                        // elemento non più trovabile, il focus è già sul campo giusto
                    }
                }
                await currentPage.keyboard.press('Enter');

                {
                    const domain = getDomainFromUrl(currentPage.url());
                    updatedDomainStatus = upsertDomainStatus(updatedDomainStatus, domain, (prev) => ({
                        ...prev,
                        submitted: true
                    }));
                    updatedCompletedDomains = tryMarkCompletedDomain(state.objective, domain, updatedDomainStatus, updatedCompletedDomains);
                }
                break;
            default:
                console.log("Azione sconosciuta o non gestita.");
        }
    } catch (e: any) {
        console.error(`Errore durante l'interazione sul browser: ${e.message}`);
    }

<<<<<<< HEAD
    const historyEntry = `${decision.action} su <${decision.tag ?? '?'}> "${decision.text ?? ''}"${decision.value ? ` valore="${decision.value}"` : ''}${decision.url ? ` verso ${decision.url}` : ''}`;
=======
    const historyEntry = `${decision.action}${decision.agentId ? ` su ${decision.agentId}` : ''}${decision.value ? ` con valore "${decision.value}"` : ''}${decision.url ? ` verso ${decision.url}` : ''}`;
>>>>>>> 9afb263 (code refactor => divided index.ts into single files, each file's function or content is explained in the README.ts)
    return {
        isFinished: false,
        lastToolCall: null,
        actionHistory: [...state.actionHistory, historyEntry],
        domainStatus: updatedDomainStatus,
        completedDomains: updatedCompletedDomains
    };
}
