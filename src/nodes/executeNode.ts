import type { AgentState } from "../types.js";
import path from "node:path";
import { promises as fs } from "node:fs";
import { parseDomAst } from "../ast.js";
import { extractObjectiveDomains, findNextTargetDomain, getDomainFromUrl, domainsMatch, upsertDomainStatus, tryMarkCompletedDomain, isConsentLikeElement, isYoutubeResultLikeElement } from "../domains.js";
import { resolveLocatorWithFallback } from "../locators.js";
import { getNetworkLog } from "../networkCapture.js";
import { getConsoleLog } from "../consoleCapture.js";
import { getUiSignalsLog } from "../uiSignalCapture.js";
import { isAllowedEmail, sendEmail } from "../email.js";
import { autoMarkTask, extractWaitSeconds, stripWaitFromObjective, currentPage, stripGotoFromObjective } from "./nodeUtil.js";
import type { AstElement, ElementTarget } from "../types.js";

const AUTO_SEND_DONE_REPORT = process.env.AUTO_SEND_DONE_REPORT === "true";

function normalizeTargetRef(args: any): string | ElementTarget | null {
    if (typeof args?.agentId === "string" && args.agentId.trim()) {
        return args.agentId.trim();
    }
    if (args?.target && typeof args.target === "object") {
        return args.target as ElementTarget;
    }
    return null;
}

function targetToHistory(targetRef: string | ElementTarget | null): string {
    if (!targetRef) return "target sconosciuto";
    if (typeof targetRef === "string") return targetRef;
    const parts = [
        targetRef.css,
        targetRef.id ? `#${targetRef.id}` : undefined,
        targetRef.name ? `name=${targetRef.name}` : undefined,
        targetRef.placeholder ? `placeholder=${targetRef.placeholder}` : undefined,
        targetRef.ariaLabel ? `aria-label=${targetRef.ariaLabel}` : undefined,
        targetRef.text ? `text=${targetRef.text}` : undefined,
        targetRef.tag
    ].filter(Boolean);
    return parts.join(" | ") || "target generico";
}

function findAstElementByTarget(domAst: string, targetRef: string | ElementTarget | null): AstElement | undefined {
    const elements = parseDomAst(domAst);
    if (!targetRef) return undefined;
    if (typeof targetRef === "string") {
        return elements.find((el) => el.agentId === targetRef);
    }

    return elements.find((el) => {
        const attrs = el.attributes || {};
        if (targetRef.id && attrs.id !== targetRef.id) return false;
        if (targetRef.name && attrs.name !== targetRef.name) return false;
        if (targetRef.placeholder && attrs.placeholder !== targetRef.placeholder) return false;
        if (targetRef.ariaLabel && attrs["aria-label"] !== targetRef.ariaLabel) return false;
        if (targetRef.role && attrs.role !== targetRef.role) return false;
        if (targetRef.href && !(attrs.href || "").includes(targetRef.href)) return false;
        if (targetRef.tag && el.tagName !== targetRef.tag.toLowerCase()) return false;
        if (targetRef.text && !((el.text || "").toLowerCase().includes(targetRef.text.toLowerCase()))) return false;
        return true;
    });
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
        if (AUTO_SEND_DONE_REPORT) {
            // Optional auto-send recap email to allowed email addresses found in objective.
            try {
                const emailsInObjective = (state.objective.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) ?? [])
                    .filter((e) => isAllowedEmail(e));
                if (emailsInObjective.length > 0) {
                    const subject = `autoQA report - ${new Date().toLocaleDateString('it-IT')}`;
                    const historySummary = state.actionHistory.map((h, i) => `${i + 1}. ${h}`).join('\n');
                    const body = `Objective: ${state.objective}\n\nExecuted actions:\n${historySummary || "none"}\n\nChecklist:\n${state.tasks || "none"}\n\nAgent reasoning: ${firstDecision.args?.reasoning || "n/a"}`;
                    for (const recipient of emailsInObjective) {
                        try {
                            const result = await sendEmail(recipient, subject, body);
                            console.log(`-> [Done] Auto report sent to ${recipient}: ${result}`);
                        } catch (e: any) {
                            console.error(`-> [Done] Auto report send error (${recipient}): ${e.message}`);
                        }
                    }
                }
            } catch (e: any) {
                console.error(`-> [Done] Unable to auto-send report email: ${e.message}`);
            }
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
    const actionableCalls = decisionCalls.filter((d: any) => ["click", "fill", "upload_file", "fill_many", "select", "enter"].includes(d?.name));

    for (const call of actionableCalls) {
        const urlBeforeCall = currentPage.url();
        try {
            switch (call.name) {
                case 'click':
                    {
                        const targetRef = normalizeTargetRef(call.args);
                        if (!targetRef) throw new Error("Azione 'click' richiede target.");
                        const clickTarget = findAstElementByTarget(state.domAst, targetRef);
                        const locator = await resolveLocatorWithFallback(state, targetRef);
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
                        historyEntries.push(`click su ${targetToHistory(targetRef)}`);
                    }
                    break;
                case 'fill':
                    {
                        const targetRef = normalizeTargetRef(call.args);
                        if (!targetRef) throw new Error("Azione 'fill' richiede target.");
                        const locator = await resolveLocatorWithFallback(state, targetRef);
                        await locator.waitFor({ state: "attached", timeout: 5000 });
                        await locator.fill(call.args?.value || "");

                        const domain = getDomainFromUrl(currentPage.url());
                        updatedDomainStatus = upsertDomainStatus(updatedDomainStatus, domain, (prev) => ({
                            ...prev,
                            filled: true
                        }));
                        historyEntries.push(`fill su ${targetToHistory(targetRef)} con valore "${call.args?.value || ""}"`);
                    }
                    break;
                case 'fill_many':
                    {
                        const items = Array.isArray(call.args?.items) ? call.args.items : [];
                        for (const item of items) {
                            const targetRef = normalizeTargetRef(item);
                            if (!targetRef) continue;
                            const locator = await resolveLocatorWithFallback(state, targetRef);
                            await locator.waitFor({ state: "attached", timeout: 5000 });
                            await locator.fill(item.value || "");
                            historyEntries.push(`fill su ${targetToHistory(targetRef)} con valore "${item.value || ""}"`);
                        }

                        const domain = getDomainFromUrl(currentPage.url());
                        updatedDomainStatus = upsertDomainStatus(updatedDomainStatus, domain, (prev) => ({
                            ...prev,
                            filled: true
                        }));
                    }
                    break;
                case 'upload_file':
                    if (!call.args?.filePath) throw new Error("Azione 'upload_file' richiede filePath.");
                    {
                        const targetRef = normalizeTargetRef(call.args);
                        if (!targetRef) throw new Error("Azione 'upload_file' richiede target.");
                        const rawPath = String(call.args.filePath).trim();
                        const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
                        await fs.access(resolvedPath);

                        const locator = await resolveLocatorWithFallback(state, targetRef);
                        await locator.waitFor({ state: "attached", timeout: 5000 });
                        await locator.setInputFiles(resolvedPath);

                        const domain = getDomainFromUrl(currentPage.url());
                        updatedDomainStatus = upsertDomainStatus(updatedDomainStatus, domain, (prev) => ({
                            ...prev,
                            filled: true
                        }));

                        historyEntries.push(`upload_file su ${targetToHistory(targetRef)} con file \"${resolvedPath}\"`);
                    }
                    break;
                case 'select':
                    {
                        const targetRef = normalizeTargetRef(call.args);
                        if (!targetRef) throw new Error("Azione 'select' richiede target.");
                        const locator = await resolveLocatorWithFallback(state, targetRef);
                        await locator.waitFor({ state: "attached", timeout: 5000 });
                        await locator.selectOption(call.args?.value || "");
                        historyEntries.push(`select su ${targetToHistory(targetRef)} con valore "${call.args?.value || ""}"`);
                    }
                    break;
                case 'enter':
                    {
                        const targetRef = normalizeTargetRef(call.args);
                        try {
                            if (targetRef) {
                                const locator = await resolveLocatorWithFallback(state, targetRef);
                                await locator.focus({ timeout: 2000 });
                            }
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
                    {
                        const targetRef = normalizeTargetRef(call.args);
                        historyEntries.push(`enter${targetRef ? ` su ${targetToHistory(targetRef)}` : ""}`);
                    }
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
