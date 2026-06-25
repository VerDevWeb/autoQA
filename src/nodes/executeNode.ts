import type { AgentState } from "../types.js";
import { parseDomAst } from "../ast.js";
import { extractObjectiveDomains, findNextTargetDomain, getDomainFromUrl, domainsMatch, upsertDomainStatus, tryMarkCompletedDomain, isConsentLikeElement, isYoutubeResultLikeElement } from "../domains.js";
import { resolveLocatorWithFallback } from "../locators.js";
import { getNetworkLog } from "../networkCapture.js";
import { getConsoleLog } from "../consoleCapture.js";
import { getUiSignalsLog } from "../uiSignalCapture.js";
import { isAllowedEmail, sendEmail } from "../email.js";
import { autoMarkTask, extractWaitSeconds, stripWaitFromObjective, currentPage, stripGotoFromObjective } from "./nodeUtil.js";


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
        // Anti-loop: if the last action was already check_network, block
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

    if (firstDecision.name === 'check_console') {
        // Anti-loop: if the last action was already check_console, block
        const lastAction = state.actionHistory[state.actionHistory.length - 1] || "";
        if (lastAction.includes("check_console")) {
            console.warn(`[GuardRail] check_console already called, skipped (loop avoided).`);
            return { isFinished: false, lastToolCall: null, consoleLogs: "" };
        }
        const log = getConsoleLog();
        console.log(`-> [Execute] Browser console messages:\n${log}`);
        const updatedTasks = autoMarkTask(state.tasks, ["check", "verific", "console", "error", "warn", "log"], firstDecision.args?.taskName);
        const updates: any = { isFinished: false, lastToolCall: null, consoleLogs: log, actionHistory: [...state.actionHistory, "check_console eseguito"] };
        if (updatedTasks !== state.tasks) updates.tasks = updatedTasks;
        return updates;
    }

    if (firstDecision.name === 'check_ui_messages') {
        // Anti-loop: if the last action was already check_ui_messages, block
        const lastAction = state.actionHistory[state.actionHistory.length - 1] || "";
        if (lastAction.includes("check_ui_messages")) {
            console.warn(`[GuardRail] check_ui_messages already called, skipped (loop avoided).`);
            return { isFinished: false, lastToolCall: null, uiSignals: "" };
        }
        const log = getUiSignalsLog();
        console.log(`-> [Execute] Transient UI messages:\n${log}`);
        const updatedTasks = autoMarkTask(state.tasks, ["check", "verific", "toast", "snackbar", "alert", "messagg", "errore", "error"], firstDecision.args?.taskName);
        const updates: any = { isFinished: false, lastToolCall: null, uiSignals: log, actionHistory: [...state.actionHistory, "check_ui_messages eseguito"] };
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

        // Anti-loop: if the exact same URL was already navigated, block and auto-execute wait if needed
        const alreadyNavigated = state.actionHistory.some(h => h.includes(`verso ${targetUrl}`));
        if (alreadyNavigated) {
            const waitSeconds = extractWaitSeconds(state.objective);
            const waitAlreadyDone = state.actionHistory.some(h => h.includes("wait"));
            if (waitSeconds && !waitAlreadyDone) {
                console.log(`[AutoWait] Detected goto loop, auto-waiting ${waitSeconds} seconds...`);
                await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
                console.log("[AutoWait] Wait completed, continuing.");
                const autoWaitTasks = autoMarkTask(state.tasks, ["wait", "pause"]);
                const autoWaitUpdates: any = {
                    isFinished: false,
                    lastToolCall: null,
                    actionHistory: [...state.actionHistory, `auto-wait ${waitSeconds}s executed after goto loop`],
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

        const gotoUpdatedTasks = autoMarkTask(state.tasks, [targetUrl, "navig", "goto", "apri"], firstDecision.args?.taskName);
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
                            // element no longer findable, focus is already on the right field
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
