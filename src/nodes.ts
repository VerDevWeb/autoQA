import type { Page } from "playwright";
import type { AgentState } from "./types.js";
import { HumanMessage } from "@langchain/core/messages";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { extractSimplifiedDOMWithRetry, parseDomElements } from "./ast.js";
import { extractObjectiveDomains, findNextTargetDomain, getDomainFromUrl, domainsMatch, upsertDomainStatus, tryMarkCompletedDomain, isConsentLikeElement, isYoutubeResultLikeElement, } from "./domains.js";
import { resolveLocator } from "./locators.js";
import {
    incrementIterationCounter,
    estimateInputTokens,
    getReportedInputTokens,
    recordIterationTokens,
    llmIterationCounter,
} from "./tokens.js";

let currentPage: Page;

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

export function setPageForNodes(page: Page): void {
    currentPage = page;
}

export async function observeNode(state: AgentState): Promise<Partial<AgentState>> {
    await sleep(500);
    console.log("-> [Observe] Analisi del DOM corrente...");
    await Promise.race([
        currentPage.waitForLoadState("load"),
        new Promise(resolve => setTimeout(resolve, 3000))
    ]);
    const currentUrl = currentPage.url();
    const result = await extractSimplifiedDOMWithRetry(currentPage);

    return { currentUrl, domAst: result.tree, domElements: JSON.stringify(result.elements) };
}

export async function decideNode(
    state: AgentState,
    llmWithTools: any
): Promise<Partial<AgentState>> {
    await sleep(500);
    console.log("-> [Decide] L'LLM sta scegliendo il tool da invocare...");

    const objectiveDomains = extractObjectiveDomains(state.objective);
    const nextTargetDomain = findNextTargetDomain(objectiveDomains, state.completedDomains);

    if (objectiveDomains.length > 0 && nextTargetDomain === null) {
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
        : "";

    const finalPrompt = `${reinforcedPrompt}${sequenceRule}`;

    incrementIterationCounter();
    const estimatedInputTokens = estimateInputTokens(finalPrompt);
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
    const reportedInputTokens = getReportedInputTokens(response);
    recordIterationTokens(estimatedInputTokens, reportedInputTokens, llmIterationCounter);

    const toolCalls = response.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
        const toolCall = toolCalls[0];
        if (toolCall) {
            console.log(`Tool selezionato: ${toolCall.name} con argomenti:`, toolCall.args);
            const progress = toolCall.args?.progress || state.progress;
            return { lastToolCall: toolCall.args, noToolCallStreak: 0, progress };
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
    await sleep(500);
    if (state.isFinished) {
        return { isFinished: true, lastToolCall: null };
    }

    const decision = state.lastToolCall;
    if (!decision) {
        return { isFinished: true, lastToolCall: null };
    }

    console.log(`-> [Execute] Azione: ${decision.action} su <${decision.tag ?? '?'}> "${decision.text ?? ''}" (${decision.reasoning})`);

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

    const historyEntry = `${decision.action} su <${decision.tag ?? '?'}> "${decision.text ?? ''}"${decision.value ? ` valore="${decision.value}"` : ''}${decision.url ? ` verso ${decision.url}` : ''}`;
    return {
        isFinished: false,
        lastToolCall: null,
        actionHistory: [...state.actionHistory, historyEntry],
        domainStatus: updatedDomainStatus,
        completedDomains: updatedCompletedDomains
    };
}
