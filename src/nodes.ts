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

// Cerca una linea nella checklist che contiene taskName (se fornito) o una delle keyword e la segna [x]
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
        return { isFinished: true, lastToolCall: null, networkLog: "", consoleLogs: "" };
    }

    const historyBlock = state.actionHistory.length > 0
        ? `\nAzioni già eseguite (NON ripetere queste):\n${state.actionHistory.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n`
        : '';

    const sequenceBlock = objectiveDomains.length > 0
        ? `\nDomini obiettivo in ordine: ${objectiveDomains.join(" -> ")}\nDomini completati: ${state.completedDomains.length > 0 ? state.completedDomains.join(", ") : "nessuno"}\nProssimo dominio target: ${nextTargetDomain ?? "nessuno"}\n`
        : "";

    const compactAstForPrompt = buildCompactAstForPrompt(state.domAst);

    // Task checklist
    const tasksBlock = state.tasks
        ? `\nLa tua checklist task (segna [x] sui completati via 'progress'):\n${state.tasks}\n`
        : `\nNon hai ancora una checklist. CREALA ORA nel campo 'progress' del tool call, in formato:\n- [ ] task 1\n- [ ] task 2\n- [ ] task 3\n...\n`;

    const networkBlock = state.networkLog
        ? `\nRegistro delle ultime richieste di rete:\n${state.networkLog}\n`
        : "";

    const consoleBlock = state.consoleLogs
        ? `\nMessaggi dalla console del browser (log, errori, warning):\n${state.consoleLogs}\n`
        : "";

    const prompt = `Sei un agente di automazione web autonomo.
        Il tuo obiettivo finale è: ${state.objective}
        Ti trovi attualmente all'URL: ${state.currentUrl}
        ${historyBlock}
        ${sequenceBlock}
        ${tasksBlock}
        ${networkBlock}
        ${consoleBlock}
        Ecco l'AST COMPACT degli elementi interattivi (formato: agentId|tag|text|attributi):
        ${compactAstForPrompt}

    Analizza l'AST e invoca il PROSSIMO tool disponibile per avanzare verso l'obiettivo.`;
        
    const reinforcedPrompt = `${prompt}

    Regole operative:
    - Se non sei ancora sulla pagina giusta o l'URL corrente e' vuoto/non pertinente, usa subito il tool 'goto' con un URL completo (https://...).
    - Non ripetere azioni gia' presenti nello storico.
    - Se l'obiettivo dice "aspetta X secondi" usa SUBITO il tool 'wait' con seconds=X. L'unico modo per attendere e' chiamare questo tool.
    - NON chiamare 'goto' se sei gia' su quel dominio o se l'hai gia' chiamato prima per lo stesso URL. Se la pagina e' caricata, passa oltre.
    - Ogni volta che chiami un tool, includi SEMPRE il campo 'taskName' con il NOME ESATTO del task che stai completando (copiato dalla checklist senza la checkbox). Esempio: taskName: "Attendere 10 secondi".
    - Se devi compilare un form ma l'obiettivo non ti dice esattamente cosa scrivere, INVENTATI dati realistici (nome, email, telefono, indirizzo, descrizione, ecc.). Un test deve avere dati sensati, non lasciare campi vuoti.
    - Usa il tool 'check_network' per vedere le risposte delle richieste di rete Appena fatte (fetch, XHR). Così puoi verificare se un'operazione (es. aggiungere immobile) ha avuto successo o errore. Non abusarne, chiamalo solo quando serve.
    - I messaggi nella console del browser (LOG, WARN, ERROR) ti aiutano a capire se la pagina ha generato errori o conferme. Se vedi errori in console, potresti dover correggere qualcosa.
    - Usa il tool 'send_email' con 'to' (email valida dalla mailing list), 'subject' e 'body' per inviare un report finale di ciò che hai fatto.`;
        
    const sequenceRule = nextTargetDomain
        ? `\n- Usa il tool 'goto' solo verso il prossimo dominio target: ${nextTargetDomain}. Non tornare ai domini gia' completati.`
        : "";

    const finalPrompt = `${reinforcedPrompt}${sequenceRule}`;

    console.log("=== PROMPT INVIATO ALL'LLM ===");
    console.log(finalPrompt);
    console.log("=== FINE PROMPT ===");

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
            const progress = toolCall.args?.progress;
            const consoleLog = getConsoleLog();
            clearConsoleLog();
            const updates: any = { lastToolCall: { name: toolCall.name, args: toolCall.args }, noToolCallStreak: 0, networkLog: "", consoleLogs: consoleLog };
            if (progress) updates.tasks = progress;
            return updates;
        }
    }

    const nextNoToolCallStreak = state.noToolCallStreak + 1;
    console.warn(`L'LLM non ha invocato tool (tentativo ${nextNoToolCallStreak}/3).`);
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

    console.log(`-> [Execute] Azione: ${decision.name} su ID: ${decision.args?.agentId ?? 'N/A'} (Motivazione: ${decision.args?.reasoning})`);

    if (decision.name === 'done') {
        return { isFinished: true, lastToolCall: null };
    }

    if (decision.name === 'check_network') {
        // Anti-loop: se l'ultima azione era già check_network, blocca
        const lastAction = state.actionHistory[state.actionHistory.length - 1] || "";
        if (lastAction.includes("check_network")) {
            console.warn(`[GuardRail] check_network già chiamato, ignorato (loop evitato).`);
            return { isFinished: false, lastToolCall: null, networkLog: "" };
        }
        const log = getNetworkLog();
        console.log(`-> [Execute] Richieste di rete registrate:\n${log}`);
        const updatedTasks = autoMarkTask(state.tasks, ["check", "verific", "network", "rete"], decision.args?.taskName);
        const updates: any = { isFinished: false, lastToolCall: null, networkLog: log, actionHistory: [...state.actionHistory, "check_network eseguito"] };
        if (updatedTasks !== state.tasks) updates.tasks = updatedTasks;
        return updates;
    }

    if (decision.name === 'send_email') {
        const targetEmail = decision.args?.to;
        if (!targetEmail) {
            console.error("Azione 'send_email' senza destinatario.");
            return { isFinished: false, lastToolCall: null, networkLog: "" };
        }
        if (!isAllowedEmail(targetEmail)) {
            const blocked = `send_email bloccato: ${targetEmail} non è nella mailing list`;
            console.warn(`[GuardRail] ${blocked}`);
            return {
                isFinished: false, lastToolCall: null, networkLog: "",
                actionHistory: [...state.actionHistory, blocked]
            };
        }
        const subject = decision.args?.subject || `Report autoQA - ${new Date().toLocaleDateString('it-IT')}`;
        const historySummary = state.actionHistory.map((h, i) => `${i + 1}. ${h}`).join('\n');
        const body = decision.args?.body || `Resoconto dell'agente:\n\nObiettivo: ${state.objective}\n\nAzioni eseguite:\n${historySummary}\n\nChecklist:\n${state.tasks || "nessuna"}`;
        try {
            const result = await sendEmail(targetEmail, subject, body);
            console.log(`-> [Execute] ${result}`);
            const updatedTasks = autoMarkTask(state.tasks, ["email", "invia", "report", "send"], decision.args?.taskName);
            const updates: any = { isFinished: false, lastToolCall: null, networkLog: "" };
            if (updatedTasks !== state.tasks) updates.tasks = updatedTasks;
            updates.actionHistory = [...state.actionHistory, `send_email a ${targetEmail}`];
            return updates;
        } catch (e: any) {
            console.error(`Errore invio email: ${e.message}`);
            return { isFinished: false, lastToolCall: null, networkLog: "" };
        }
    }

    if (decision.name === 'goto') {
        const targetUrl = decision.args?.url;
        if (!targetUrl) {
            console.error("Azione 'goto' senza URL.");
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
            const blocked = `goto ignorato: ${targetUrl} gia' navigato prima (loop evitato)`;
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

        const gotoUpdatedTasks = autoMarkTask(state.tasks, [targetUrl, "navig", "vai su", "goto", "apri"], decision.args?.taskName);
        const gotoUpdates: any = { isFinished: false, lastToolCall: null, objective: stripGotoFromObjective(state.objective, targetUrl) };
        if (gotoUpdatedTasks !== state.tasks) gotoUpdates.tasks = gotoUpdatedTasks;
        return gotoUpdates;
    }

    if (decision.name === 'wait') {
        const seconds = decision.args?.seconds ?? 5;
        console.log(`-> [Execute] Attesa di ${seconds} secondi...`);
        await new Promise(resolve => setTimeout(resolve, seconds * 1000));
        console.log(`-> [Execute] Attesa completata.`);
        const updatedTasks = autoMarkTask(state.tasks, ["attend", "aspett", "wait", "second", "pausa"], decision.args?.taskName);
        const updates: any = { isFinished: false, lastToolCall: null, objective: stripWaitFromObjective(state.objective) };
        if (updatedTasks !== state.tasks) updates.tasks = updatedTasks;
        return updates;
    }

    let updatedDomainStatus = state.domainStatus;
    let updatedCompletedDomains = state.completedDomains;

    try {
        switch (decision.name) {
            case 'click':
                if (!decision.args?.agentId) throw new Error("Azione 'click' richiede agentId.");
                {
                    const clickTarget = parseDomAst(state.domAst).find((el) => el.agentId === decision.args!.agentId);
                    const locator = await resolveLocatorWithFallback(state, decision.args!.agentId);
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
                if (!decision.args?.agentId) throw new Error("Azione 'fill' richiede agentId.");
                {
                    const locator = await resolveLocatorWithFallback(state, decision.args!.agentId);
                    await locator.waitFor({ state: "attached", timeout: 5000 });
                    await locator.fill(decision.args?.value || "");

                    const domain = getDomainFromUrl(currentPage.url());
                    updatedDomainStatus = upsertDomainStatus(updatedDomainStatus, domain, (prev) => ({
                        ...prev,
                        filled: true
                    }));
                }
                break;
            case 'select':
                if (!decision.args?.agentId) throw new Error("Azione 'select' richiede agentId.");
                {
                    const locator = await resolveLocatorWithFallback(state, decision.args!.agentId);
                    await locator.waitFor({ state: "attached", timeout: 5000 });
                    await locator.selectOption(decision.args?.value || "");
                }
                break;
            case 'enter':
                if (decision.args?.agentId) {
                    try {
                        const locator = await resolveLocatorWithFallback(state, decision.args!.agentId);
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

    const historyEntry = `${decision.name}${decision.args?.agentId ? ` su ${decision.args?.agentId}` : ''}${decision.args?.value ? ` con valore "${decision.args?.value}"` : ''}${decision.args?.url ? ` verso ${decision.args?.url}` : ''}`;
    return {
        isFinished: false,
        lastToolCall: null,
        actionHistory: [...state.actionHistory, historyEntry],
        domainStatus: updatedDomainStatus,
        completedDomains: updatedCompletedDomains
    };
}
