import type { Page } from "playwright";
import type { AgentState } from "./types.js";
import { HumanMessage } from "@langchain/core/messages";
import { extractSimplifiedDOMWithRetry, buildCompactAstForPrompt, parseDomAst } from "./ast.js";
import { extractObjectiveDomains, findNextTargetDomain, getDomainFromUrl, domainsMatch, upsertDomainStatus, tryMarkCompletedDomain, isConsentLikeElement, isYoutubeResultLikeElement } from "./domains.js";
import { resolveLocatorWithFallback } from "./locators.js";
import { incrementIterationCounter, estimateInputTokens, getReportedInputTokens, recordIterationTokens, llmIterationCounter } from "./tokens.js";
import { getNetworkLog } from "./networkCapture.js";
import { getConsoleLog, clearConsoleLog } from "./consoleCapture.js";
import { isAllowedEmail, sendEmail } from "./email.js";

// Cerca "aspetta X secondi" nell'obiettivo e restituisce i secondi, oppure null
function extractWaitSeconds(objective: string): number | null {
    const match = objective.match(/(?:aspetta|attendi|wait)\s*(\d+)\s*(?:secondi?|seconds?|sec)/i);
    return match ? parseInt(match[1] ?? "", 10) || null : null;
}

// Rimuove la parte "Vai su URL" dall'obiettivo
function stripGotoFromObjective(objective: string, url: string): string {
    const urlPattern = escapeRegex(url);
    const gotoRegex = new RegExp(`(?:vai\\s*(?:su|a)?\\s*)?${urlPattern}[.,]?\\s*`, 'gi');
    return objective.replace(gotoRegex, "").replace(/\s+,/g, ",").replace(/,\s*,/g, ",").trim();
}

// Rimuove "aspetta X secondi" dall'obiettivo
function stripWaitFromObjective(objective: string): string {
    return objective.replace(/(?:aspetta|attendi|wait)\s*\d+\s*(?:secondi?|seconds?|sec)[.,]?\s*/gi, "")
        .replace(/\s+,/g, ",").replace(/,\s*,/g, ",").trim();
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Find a line in the checklist that matches taskName (if provided) or one of the keywords and mark it [x]
function autoMarkTask(tasks: string, keywords: string[], taskName?: string): string {
    if (!tasks) return tasks;
    const lines = tasks.split('\n');
    let found = false;
    const updated = lines.map(line => {
        if (found) return line;
        const isUnchecked = line.match(/-\s*\[\s*\]/);
        if (!isUnchecked) return line;
        const lower = line.toLowerCase();
        // Se taskName è fornito, match esatto su quella stringa
        if (taskName) {
            if (lower.includes(taskName.toLowerCase())) {
                found = true;
                console.log(`[Task] Auto-marcato [x] (match esatto): ${line.trim()}`);
                return line.replace(/-\s*\[\s*\]/, '- [x]');
            }
            return line;
        }
        // Altrimenti match per keyword
        const match = keywords.some(kw => lower.includes(kw));
        if (match) {
            found = true;
            console.log(`[Task] Auto-marcato [x]: ${line.trim()}`);
            return line.replace(/-\s*\[\s*\]/, '- [x]');
        }
        return line;
    });
    return updated.join('\n');
}

function hasCriticalRiskSignals(consoleLogs: string, networkLog: string): boolean {
    const text = `${consoleLogs || ""}\n${networkLog || ""}`.toLowerCase();
    const criticalSignals = [
        "captcha",
        "account locked",
        "too many requests",
        "rate limit",
        "unauthorized",
        "forbidden",
        "500",
        "fatal",
        "blocked",
        "page, context or browser has been closed"
    ];
    return criticalSignals.some((s) => text.includes(s));
}

function actionKind(entry: string): string {
    const lower = (entry || "").toLowerCase().trim();
    if (!lower) return "";
    if (lower.startsWith("click")) return "click";
    if (lower.startsWith("fill")) return "fill";
    if (lower.startsWith("select")) return "select";
    if (lower.startsWith("enter")) return "enter";
    if (lower.startsWith("goto")) return "goto";
    if (lower.startsWith("check_network")) return "check_network";
    if (lower.startsWith("wait") || lower.includes("attesa")) return "wait";
    return lower.split(" ")[0] || lower;
}

function hasRepetitiveLoop(actionHistory: string[]): boolean {
    if (!Array.isArray(actionHistory) || actionHistory.length < 4) return false;
    const recent = actionHistory.slice(-6).map(actionKind).filter(Boolean);
    if (recent.length < 4) return false;

    const last4 = recent.slice(-4);
    const unique = new Set(last4);
    if (unique.size === 1) return true;

    // ABAB style oscillation (e.g. click, fill, click, fill)
    if (last4.length === 4 && last4[0] === last4[2] && last4[1] === last4[3]) {
        return true;
    }

    return false;
}

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
    console.log("-> [Observe] Analyzing current DOM...");
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
    console.log("-> [Decide] LLM is selecting the next tool...");

    const objectiveDomains = extractObjectiveDomains(state.objective);
    const nextTargetDomain = findNextTargetDomain(objectiveDomains, state.completedDomains);

    if (objectiveDomains.length > 0 && nextTargetDomain === null) {
        console.log("[Decide] All objective domains are completed.");
        return { isFinished: true, lastToolCall: null, networkLog: "", consoleLogs: "" };
    }

    const historyBlock = state.actionHistory.length > 0
        ? `\nActions already executed (DO NOT repeat these):\n${state.actionHistory.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n`
        : '';

    const sequenceBlock = objectiveDomains.length > 0
        ? `\nTarget domains in order: ${objectiveDomains.join(" -> ")}\nCompleted domains: ${state.completedDomains.length > 0 ? state.completedDomains.join(", ") : "none"}\nNext target domain: ${nextTargetDomain ?? "none"}\n`
        : "";

    const compactAstForPrompt = buildCompactAstForPrompt(state.domAst);

    // Task checklist
    const tasksBlock = state.tasks
        ? `\nYour task checklist (mark [x] completed items via 'progress'):\n${state.tasks}\n`
        : `\nYou don't have a checklist yet. CREATE ONE NOW in the 'progress' field of your first tool call, in format:\n- [ ] task 1\n- [ ] task 2\n- [ ] task 3\n...\n`;

    const networkBlock = state.networkLog
        ? `\nRecent network request log:\n${state.networkLog}\n`
        : "";

    const consoleBlock = state.consoleLogs
        ? `\nBrowser console messages (logs, errors, warnings):\n${state.consoleLogs}\n`
        : "";

    const criticalRiskDetected = hasCriticalRiskSignals(state.consoleLogs, state.networkLog);
    const repetitiveLoopDetected = hasRepetitiveLoop(state.actionHistory);

    const emergencyStopBlock = criticalRiskDetected && repetitiveLoopDetected
        ? `\nEMERGENCY STOP CONDITION DETECTED:\n- Critical risk signals are present in network/console logs.\n- Recent iterations are repetitive without progress.\nYOU MUST call 'done' now with a clear reasoning describing the risk and loop condition sent via email tool.\n`
        : "";

    const prompt = `You are an autonomous web automation agent.
Your final objective is: ${state.objective}
You are currently at URL: ${state.currentUrl}
${historyBlock}
${sequenceBlock}
${tasksBlock}
${networkBlock}
${consoleBlock}
${emergencyStopBlock}
Here is the COMPACT AST of the page (indented tree with significant containers + interactive elements, including key HTML attributes, labels, innerText and agentId):
${compactAstForPrompt}

Analyze the AST and invoke the NEXT available tool to progress toward the objective.`;

    const reinforcedPrompt = `${prompt}

Operational rules:

[TASK MANAGEMENT]
- You MUST create a checklist in the 'progress' field on your FIRST tool call. Format:
  - [ ] task 1
  - [ ] task 2
  - [ ] task 3
- On EVERY tool call, include 'taskName' (exact line from checklist without checkbox) and the updated 'progress'.
- Mark tasks as [x] via 'progress' ONLY when you have verified they are actually done.

[NAVIGATION]
- If the current URL is empty or irrelevant, use 'goto' immediately with a full URL (https://...).
- Do NOT call 'goto' if you are already on the correct domain or if you already navigated to the same URL.
- If the objective spans multiple domains, visit them in order and do NOT return to completed domains.

[FORM FILLING]
- When you encounter a form, identify ALL input/select/textarea fields in the AST.
- For each field, determine its purpose from: type, name, placeholder, aria-label, label, innerText, and container hierarchy in the tree.
- Fill EVERY visible form field with realistic test data. Invent names, emails, phones, addresses, descriptions as needed.
- Do NOT skip any field. If you are unsure what a field is for, use common sense from its name/placeholder/aria-label.
- Prefer ONE SHOT form filling:
    - Use 'fill_many' with all fields when possible.
    - Alternatively, return multiple tool calls in the same response (e.g. many 'fill' calls), one per field.
- Submit the form only after ALL required fields are filled.

[VERIFICATION & SELF-CORRECTION]
- After every action, in the NEXT iteration, examine the current DOM and URL carefully.
- Ask yourself: "Did my last action produce the expected result?" 
- If the page, URL, or DOM did NOT change as expected, do NOT declare completion. Instead:
  - If you tried to navigate but are still on the same page, retry 'goto' or look for obstacles (popups, cookie banners).
  - If you tried to fill a field but the value is still empty, retry 'fill'.
  - If you tried to click but nothing changed, try a different element or use 'enter'.
- Only call 'done' when you have IRREFUTABLE EVIDENCE that every task is complete. Evidence includes:
  - URL has changed to the expected page.
  - The DOM shows confirmation messages, success indicators, or expected new content.
  - Network/capture shows successful API responses (2xx).
- If the page still shows the registration form / input form after you submitted, you are NOT done. Keep working.

[NETWORK & CONSOLE]
- Use 'check_network' to inspect API responses right after a submission. This tells you if the operation succeeded or failed.
- Browser console messages (LOG, WARN, ERROR) help you detect page issues. If you see errors, investigate.

[CRITICAL RISK STOP]
- If you detect critical risk signals (captcha, account lock, repeated 4xx/5xx auth failures, rate limits, browser/context closed errors) and recent iterations are repeating the same actions without progress, call 'done' as an emergency stop.
- In this emergency case, explain the risk and why continuing would be unsafe or useless.
- Do NOT continue blind retries when this condition is met.

[EMAIL]
- Use 'send_email' with 'to' (from mailing list), 'subject', and 'body' to send a final report.

[DECISION FRAMEWORK - ALWAYS FOLLOW THIS]
Every time you receive the AST, go through this structured reasoning:
1. GOAL: What is my current objective step? (from checklist)
2. STATE: Where am I now? (URL + DOM content)
3. VERIFY: Did my previous action succeed? Compare DOM/URL with what I expected.
4. PLAN: What is the single next action that brings me closer to the goal?
5. EXECUTE: Invoke the tool with full arguments.

Never skip step 3. If verification fails, your plan must address the failure, not ignore it.`;

    const sequenceRule = nextTargetDomain
        ? `\n- If you use 'goto', go ONLY to: ${nextTargetDomain}. Do not return to completed domains.`
        : "";

    const finalPrompt = `${reinforcedPrompt}${sequenceRule}`;

    /*
    console.log("=== PROMPT SENT TO LLM ===");
    console.log(finalPrompt);
    console.log("=== PROMPT END ===");
    */

    incrementIterationCounter();
    const estimatedInputTokens = estimateInputTokens(finalPrompt);
    
    const response = await llmWithTools.invoke([new HumanMessage(finalPrompt)]);
    const reportedInputTokens = getReportedInputTokens(response);
    recordIterationTokens(estimatedInputTokens, reportedInputTokens, llmIterationCounter);

    const toolCalls = response.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
        const normalizedToolCalls = toolCalls
            .filter((tc: any) => tc?.name)
            .map((tc: any) => ({ name: tc.name, args: tc.args || {} }));

        if (normalizedToolCalls.length > 0) {
            console.log(`Tools selected (${normalizedToolCalls.length}):`, normalizedToolCalls.map((tc: any) => tc.name).join(", "));
            const latestProgress = [...normalizedToolCalls]
                .reverse()
                .find((tc: any) => typeof tc.args?.progress === "string" && tc.args.progress.trim().length > 0)?.args?.progress;

            const consoleLog = getConsoleLog();
            clearConsoleLog();

            const updates: any = {
                lastToolCall: normalizedToolCalls.length === 1 ? normalizedToolCalls[0] : { calls: normalizedToolCalls },
                noToolCallStreak: 0,
                networkLog: "",
                consoleLogs: consoleLog
            };

            if (latestProgress) updates.tasks = latestProgress;
            return updates;
        }
    }

    const nextNoToolCallStreak = state.noToolCallStreak + 1;
    console.warn(`LLM did not invoke a tool (attempt ${nextNoToolCallStreak}/3).`);
    if (nextNoToolCallStreak >= 3) {
        return { isFinished: true, lastToolCall: null, noToolCallStreak: nextNoToolCallStreak, networkLog: "", consoleLogs: "" };
    }

    return { isFinished: false, lastToolCall: null, noToolCallStreak: nextNoToolCallStreak, networkLog: "", consoleLogs: "" };
}

export async function executeNode(state: AgentState): Promise<Partial<AgentState>> {
    if (state.isFinished) {
        return { isFinished: true, lastToolCall: null };
    }

    const decision = state.lastToolCall;
    if (!decision) {
        return { isFinished: true, lastToolCall: null };
    }

    const decisionCalls = Array.isArray((decision as any)?.calls)
        ? (decision as any).calls
        : [decision];
    const firstDecision = decisionCalls[0];
    if (!firstDecision?.name) {
        return { isFinished: false, lastToolCall: null };
    }

    console.log(`-> [Execute] Actions: ${decisionCalls.map((d: any) => d.name).join(", ")}`);

    if (firstDecision.name === 'done') {
        // Auto-send recap email to every allowed email address found in the objective
        try {
            const emailsInObjective = (state.objective.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) ?? [])
                .filter((e) => isAllowedEmail(e));
            if (emailsInObjective.length > 0) {
                const subject = `autoQA report - ${new Date().toLocaleDateString('it-IT')}`;
                const historySummary = state.actionHistory.map((h, i) => `${i + 1}. ${h}`).join('\n');
                const body = `Obiettivo: ${state.objective}\n\nAzioni eseguite:\n${historySummary || "nessuna"}\n\nChecklist:\n${state.tasks || "nessuna"}\n\nReasoning agente: ${firstDecision.args?.reasoning || "n/d"}`;
                for (const recipient of emailsInObjective) {
                    try {
                        const result = await sendEmail(recipient, subject, body);
                        console.log(`-> [Done] Resoconto inviato a ${recipient}: ${result}`);
                    } catch (e: any) {
                        console.error(`-> [Done] Errore invio email a ${recipient}: ${e.message}`);
                    }
                }
            } else {
                console.log("-> [Done] Nessuna email valida trovata nell'obiettivo, resoconto non inviato.");
            }
        } catch (e: any) {
            console.error(`-> [Done] Impossibile inviare email di resoconto: ${e.message}`);
        }
        return { isFinished: true, lastToolCall: null };
    }

    if (firstDecision.name === 'check_network') {
        // Anti-loop: se l'ultima azione era già check_network, blocca
        const lastAction = state.actionHistory[state.actionHistory.length - 1] || "";
        if (lastAction.includes("check_network")) {
            console.warn(`[GuardRail] check_network already called, skipped (loop avoided).`);
            return { isFinished: false, lastToolCall: null, networkLog: "" };
        }
        const log = getNetworkLog();
        console.log(`-> [Execute] Network requests logged:\n${log}`);
        const updatedTasks = autoMarkTask(state.tasks, ["check", "verific", "network", "rete"], firstDecision.args?.taskName);
        const updates: any = { isFinished: false, lastToolCall: null, networkLog: log, actionHistory: [...state.actionHistory, "check_network eseguito"] };
        if (updatedTasks !== state.tasks) updates.tasks = updatedTasks;
        return updates;
    }

    if (firstDecision.name === 'send_email') {
        const targetEmail = firstDecision.args?.to;
        if (!targetEmail) {
            console.error("'send_email' action without recipient.");
            return { isFinished: false, lastToolCall: null, networkLog: "" };
        }
        if (!isAllowedEmail(targetEmail)) {
            const blocked = `send_email blocked: ${targetEmail} is not in the mailing list`;
            console.warn(`[GuardRail] ${blocked}`);
            return {
                isFinished: false, lastToolCall: null, networkLog: "",
                actionHistory: [...state.actionHistory, blocked]
            };
        }
        const subject = firstDecision.args?.subject || `Report autoQA - ${new Date().toLocaleDateString('it-IT')}`;
        const historySummary = state.actionHistory.map((h, i) => `${i + 1}. ${h}`).join('\n');
        const body = firstDecision.args?.body || `Resoconto dell'agente:\n\nObiettivo: ${state.objective}\n\nAzioni eseguite:\n${historySummary}\n\nChecklist:\n${state.tasks || "nessuna"}`;
        try {
            const result = await sendEmail(targetEmail, subject, body);
            console.log(`-> [Execute] ${result}`);
            const updatedTasks = autoMarkTask(state.tasks, ["email", "invia", "report", "send"], firstDecision.args?.taskName);
            const updates: any = { isFinished: false, lastToolCall: null, networkLog: "" };
            if (updatedTasks !== state.tasks) updates.tasks = updatedTasks;
            updates.actionHistory = [...state.actionHistory, `send_email a ${targetEmail}`];
            return updates;
        } catch (e: any) {
            console.error(`Email send error: ${e.message}`);
            return { isFinished: false, lastToolCall: null, networkLog: "" };
        }
    }

    if (firstDecision.name === 'goto') {
        const targetUrl = firstDecision.args?.url;
        if (!targetUrl) {
            console.error("'goto' action without URL.");
            return { isFinished: false, lastToolCall: null };
        }

        // Anti-loop: se lo stesso identico URL e' gia' stato navigato, blocca e auto-esegue l'attesa se richiesta
        const alreadyNavigated = state.actionHistory.some(h => h.includes(`verso ${targetUrl}`));
        if (alreadyNavigated) {
            const waitSeconds = extractWaitSeconds(state.objective);
            const waitAlreadyDone = state.actionHistory.some(h => h.includes("wait") || h.includes("attesa"));
            if (waitSeconds && !waitAlreadyDone) {
                console.log(`[AutoWait] Rilevato loop goto, auto-attesa di ${waitSeconds} secondi...`);
                await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
                console.log("[AutoWait] Attesa completata, proseguo.");
                const autoWaitTasks = autoMarkTask(state.tasks, ["attend", "aspett", "wait", "second", "pausa"]);
                const autoWaitUpdates: any = {
                    isFinished: false,
                    lastToolCall: null,
                    actionHistory: [...state.actionHistory, `auto-attesa ${waitSeconds}s eseguita dopo goto loop`],
                    objective: stripWaitFromObjective(state.objective)
                };
                if (autoWaitTasks !== state.tasks) autoWaitUpdates.tasks = autoWaitTasks;
                return autoWaitUpdates;
            }
            const blocked = `goto skipped: ${targetUrl} already navigated (loop avoided)`;
            console.warn(`[GuardRail] ${blocked}`);
            return {
                isFinished: false,
                lastToolCall: null,
                actionHistory: [...state.actionHistory, blocked]
            };
        }

        const objectiveDomains = extractObjectiveDomains(state.objective);
        const nextTargetDomain = findNextTargetDomain(objectiveDomains, state.completedDomains);
        const targetDomain = getDomainFromUrl(targetUrl);

        if (nextTargetDomain && targetDomain && !domainsMatch(targetDomain, nextTargetDomain)) {
            const blocked = `goto blocked to ${targetDomain} (expected: ${nextTargetDomain})`;
            console.warn(`[GuardRail] ${blocked}`);
            return {
                isFinished: false,
                lastToolCall: null,
                actionHistory: [...state.actionHistory, blocked]
            };
        }

        if (targetDomain && state.completedDomains.some((d) => domainsMatch(d, targetDomain)) && nextTargetDomain) {
            const blocked = `goto blocked to already completed domain: ${targetDomain}`;
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
            console.error(`Navigation error to ${targetUrl}: ${e.message}`);
        }

        const gotoUpdatedTasks = autoMarkTask(state.tasks, [targetUrl, "navig", "vai su", "goto", "apri"], firstDecision.args?.taskName);
        const gotoUpdates: any = { isFinished: false, lastToolCall: null, objective: stripGotoFromObjective(state.objective, targetUrl) };
        if (gotoUpdatedTasks !== state.tasks) gotoUpdates.tasks = gotoUpdatedTasks;
        return gotoUpdates;
    }

    if (firstDecision.name === 'wait') {
        const seconds = firstDecision.args?.seconds ?? 5;
        console.log(`-> [Execute] Waiting ${seconds} seconds...`);
        await new Promise(resolve => setTimeout(resolve, seconds * 1000));
        console.log(`-> [Execute] Wait complete.`);
        const updatedTasks = autoMarkTask(state.tasks, ["attend", "aspett", "wait", "second", "pausa"], firstDecision.args?.taskName);
        const updates: any = { isFinished: false, lastToolCall: null, objective: stripWaitFromObjective(state.objective) };
        if (updatedTasks !== state.tasks) updates.tasks = updatedTasks;
        return updates;
    }

    let updatedDomainStatus = state.domainStatus;
    let updatedCompletedDomains = state.completedDomains;
    const historyEntries: string[] = [];
    const actionableCalls = decisionCalls.filter((d: any) => ["click", "fill", "fill_many", "select", "enter"].includes(d?.name));

    for (const call of actionableCalls) {
        const urlBeforeCall = currentPage.url();
        try {
            switch (call.name) {
                case 'click':
                    if (!call.args?.agentId) throw new Error("Azione 'click' richiede agentId.");
                    {
                        const clickTarget = parseDomAst(state.domAst).find((el) => el.agentId === call.args!.agentId);
                        const locator = await resolveLocatorWithFallback(state, call.args!.agentId);
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
                    historyEntries.push(`click su ${call.args?.agentId}`);
                    break;
                case 'fill':
                    if (!call.args?.agentId) throw new Error("Azione 'fill' richiede agentId.");
                    {
                        const locator = await resolveLocatorWithFallback(state, call.args!.agentId);
                        await locator.waitFor({ state: "attached", timeout: 5000 });
                        await locator.fill(call.args?.value || "");

                        const domain = getDomainFromUrl(currentPage.url());
                        updatedDomainStatus = upsertDomainStatus(updatedDomainStatus, domain, (prev) => ({
                            ...prev,
                            filled: true
                        }));
                    }
                    historyEntries.push(`fill su ${call.args?.agentId} con valore "${call.args?.value || ""}"`);
                    break;
                case 'fill_many':
                    {
                        const items = Array.isArray(call.args?.items) ? call.args.items : [];
                        for (const item of items) {
                            if (!item?.agentId) continue;
                            const locator = await resolveLocatorWithFallback(state, item.agentId);
                            await locator.waitFor({ state: "attached", timeout: 5000 });
                            await locator.fill(item.value || "");
                            historyEntries.push(`fill su ${item.agentId} con valore "${item.value || ""}"`);
                        }

                        const domain = getDomainFromUrl(currentPage.url());
                        updatedDomainStatus = upsertDomainStatus(updatedDomainStatus, domain, (prev) => ({
                            ...prev,
                            filled: true
                        }));
                    }
                    break;
                case 'select':
                    if (!call.args?.agentId) throw new Error("Azione 'select' richiede agentId.");
                    {
                        const locator = await resolveLocatorWithFallback(state, call.args!.agentId);
                        await locator.waitFor({ state: "attached", timeout: 5000 });
                        await locator.selectOption(call.args?.value || "");
                    }
                    historyEntries.push(`select su ${call.args?.agentId} con valore "${call.args?.value || ""}"`);
                    break;
                case 'enter':
                    if (call.args?.agentId) {
                        try {
                            const locator = await resolveLocatorWithFallback(state, call.args!.agentId);
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
                    historyEntries.push(`enter${call.args?.agentId ? ` su ${call.args?.agentId}` : ""}`);
                    break;
                default:
                    console.log("Unknown or unhandled action name.");
            }

            const urlAfterCall = currentPage.url();
            if (urlAfterCall !== urlBeforeCall) {
                const note = `batch interrotto: URL cambiato (${urlBeforeCall} -> ${urlAfterCall}), rieseguo observe prima delle prossime azioni`;
                console.log(`[BatchGuard] ${note}`);
                historyEntries.push(note);
                break;
            }
        } catch (e: any) {
            console.error(`Browser interaction error (${call.name}): ${e.message}`);
        }
    }

    return {
        isFinished: false,
        lastToolCall: null,
        actionHistory: [...state.actionHistory, ...historyEntries],
        domainStatus: updatedDomainStatus,
        completedDomains: updatedCompletedDomains
    };
}
