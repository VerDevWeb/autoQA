import type { Page } from "playwright";
import type { AgentState } from "./types.js";
import { HumanMessage } from "@langchain/core/messages";
import { extractSimplifiedDOMWithRetry, buildCompactAstForPrompt, parseDomAst } from "./ast.js";
import { extractObjectiveDomains, findNextTargetDomain, getDomainFromUrl, domainsMatch, upsertDomainStatus, tryMarkCompletedDomain, isConsentLikeElement, isYoutubeResultLikeElement } from "./domains.js";
import { resolveLocatorWithFallback } from "./locators.js";
import { incrementIterationCounter, estimateInputTokens, getReportedInputTokens, recordIterationTokens, llmIterationCounter } from "./tokens.js";

let currentPage: Page;

export function setPageForNodes(page: Page): void {
    currentPage = page;
}


/*  HOW DO THIS AGENT NODES WORK UNDER THE HOOD?

    AGENT'S EYES            -   observeNode   - this node reads the page content and extract it for the decideNode
    AGENT'S BRAIN           -   decideNode    - this node handles the reasoning part where the LLM choses what tool it needs to invoke in order to complete the current task
    AGENT'S ARMS AND HANDS  -   executeNode   - this node calls the actual tools
*/


export async function observeNode(state: AgentState): Promise<Partial<AgentState>> {
    console.log("-> [Observe] Analisi del DOM corrente...");
    await Promise.race([
        currentPage.waitForLoadState("load"),
        new Promise(resolve => setTimeout(resolve, 3000))
    ]);
    const currentUrl = currentPage.url();
    const domAst = await extractSimplifiedDOMWithRetry(currentPage);

    return { currentUrl, domAst };
}

export async function decideNode(
    state: AgentState,
    llmWithTools: any
): Promise<Partial<AgentState>> {
    console.log("-> [Decide] L'LLM sta scegliendo il tool da invocare...");

    const objectiveDomains = extractObjectiveDomains(state.objective);
    const nextTargetDomain = findNextTargetDomain(objectiveDomains, state.completedDomains);

    if (objectiveDomains.length > 0 && nextTargetDomain === null) {
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
        : "";

    const finalPrompt = `${reinforcedPrompt}${sequenceRule}`;

    incrementIterationCounter();
    const estimatedInputTokens = estimateInputTokens(finalPrompt);
    
    const response = await llmWithTools.invoke([new HumanMessage(finalPrompt)]);
    const reportedInputTokens = getReportedInputTokens(response);
    recordIterationTokens(estimatedInputTokens, reportedInputTokens, llmIterationCounter);

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
        return { isFinished: true, lastToolCall: null, noToolCallStreak: nextNoToolCallStreak };
    }

    return { isFinished: false, lastToolCall: null, noToolCallStreak: nextNoToolCallStreak };
}

export async function executeNode(state: AgentState): Promise<Partial<AgentState>> {
    if (state.isFinished) {
        return { isFinished: true, lastToolCall: null };
    }

    const decision = state.lastToolCall;
    if (!decision) {
        return { isFinished: true, lastToolCall: null };
    }

    console.log(`-> [Execute] Azione: ${decision.action} su ID: ${decision.agentId ?? 'N/A'} (Motivazione: ${decision.reasoning})`);

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

    const historyEntry = `${decision.action}${decision.agentId ? ` su ${decision.agentId}` : ''}${decision.value ? ` con valore "${decision.value}"` : ''}${decision.url ? ` verso ${decision.url}` : ''}`;
    return {
        isFinished: false,
        lastToolCall: null,
        actionHistory: [...state.actionHistory, historyEntry],
        domainStatus: updatedDomainStatus,
        completedDomains: updatedCompletedDomains
    };
}
