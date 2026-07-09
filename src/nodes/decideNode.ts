import type { AgentState } from "../types.js";
import { HumanMessage } from "@langchain/core/messages";
import { buildCompactAstForPrompt } from "../ast.js";
import { extractObjectiveDomains, findNextTargetDomain } from "../domains.js";
import { incrementIterationCounter, estimateInputTokens, getReportedInputTokens, recordIterationTokens, llmIterationCounter } from "../tokens.js";

export async function decideNode(state: AgentState, llmWithTools: any): Promise<Partial<AgentState>> {
    console.log("-> [Decide] LLM is selecting the next tool...");

    const objectiveDomains = extractObjectiveDomains(state.objective);
    const nextTargetDomain = findNextTargetDomain(objectiveDomains, state.completedDomains);

    if (objectiveDomains.length > 0 && nextTargetDomain === null) {
        console.log("[Decide] All objective domains are completed.");
        return { isFinished: true, lastToolCall: null, networkLog: "", consoleLogs: "", uiSignals: "" };
    }

    const historyBlock = state.actionHistory.length > 0
        ? `\nActions already executed (DO NOT repeat these):\n${state.actionHistory.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n`
        : '';

    const sequenceBlock = objectiveDomains.length > 0
        ? `\nTarget domains in order: ${objectiveDomains.join(" -> ")}\nCompleted domains: ${state.completedDomains.length > 0 ? state.completedDomains.join(", ") : "none"}\nNext target domain: ${nextTargetDomain ?? "none"}\n`
        : "";

    const compactAstForPrompt = buildCompactAstForPrompt(state.domAst);
    console.log("[Decide] COMPACT AST sent to LLM:\n" + (compactAstForPrompt || "<empty>"));

    // Task checklist
    const tasksBlock = state.tasks
        ? `\nYour task checklist (mark [x] completed items via 'progress'):\n${state.tasks}\n`
        : `\nYou don't have a checklist yet. CREATE ONE NOW in the 'progress' field of your first tool call, in format:\n- [ ] task 1\n- [ ] task 2\n- [ ] task 3\n...\n`;

    const diagnosticsBlock = (state.networkLog || state.consoleLogs || state.uiSignals)
        ? `\nDiagnostic tool outputs from previous step (requested by you):\n${state.networkLog ? `\n[check_network]\n${state.networkLog}\n` : ""}${state.consoleLogs ? `\n[check_console]\n${state.consoleLogs}\n` : ""}${state.uiSignals ? `\n[check_ui_messages]\n${state.uiSignals}\n` : ""}`
        : "";

    const realtimeAlertsBlock = (state.realtimeNetworkAlerts || state.realtimeConsoleAlerts)
        ? `\nReal-time runtime alerts (auto-captured, not requested by tool):\n${state.realtimeNetworkAlerts ? `\n[realtime_network_issues]\n${state.realtimeNetworkAlerts}\n` : ""}${state.realtimeConsoleAlerts ? `\n[realtime_console_issues]\n${state.realtimeConsoleAlerts}\n` : ""}`
        : "";

    const prompt = `You are an autonomous web automation agent.
    Your final objective is: ${state.objective}
    You are currently at URL: ${state.currentUrl}
    ${historyBlock}
    ${sequenceBlock}
    ${tasksBlock}
    ${diagnosticsBlock}
    ${realtimeAlertsBlock}
    Here is the COMPACT AST of the page (indented tree with significant containers + interactive elements, including key HTML attributes, labels and innerText):
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
    - For click/fill/select/upload_file/enter tools, ALWAYS pass a precise 'target' object using real HTML attributes from the AST (id, name, placeholder, aria-label, role, text, href, tag, css when needed).
    - For each field, determine its purpose from: type, name, placeholder, aria-label, label, innerText, and container hierarchy in the tree.
    - Fill EVERY visible form field with realistic test data. Invent names, emails, phones, addresses, descriptions as needed.
    - Do NOT skip any field. If you are unsure what a field is for, use common sense from its name/placeholder/aria-label.
    - If a field is an <input type="file">, use 'upload_file' with a valid path instead of 'fill'.
    - Prefer ONE SHOT form filling:
        - Use 'fill_many' with all fields when possible.
        - Alternatively, return multiple tool calls in the same response (e.g. many 'fill' calls), one per field.
    - Submit the form only after ALL required fields are filled.
    - After you click the submit button or such it's suggested to check console logs to see if there are any errors that you should report
    - If you notice any errors that are holding you back, please send them to me in the summary email

    AFTER IMPORTANT ACTIONS IT'S REALLY IMPORTANT THAT YOU CHECH THE CONSOLE AND NETWORK ACTIVITY TO CHECK IF THE ACTION WAS PERFORMED SUCCESSFULLY

    [VERIFICATION & SELF-CORRECTION]
    - After every action, in the NEXT iteration, examine the current DOM and URL carefully.
    - Ask yourself: "Did my last action produce the expected result?" 
    - After operational actions (fill, fill_many, select, click, enter, submit-like actions), you SHOULD run 'check_console' before declaring completion.
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
    - Use 'check_console' after operational actions and especially after submissions to catch frontend errors/warnings before finalizing.
    - If real-time alerts show errors/warnings, treat them as high-priority signals and adapt your plan immediately.
    - Use 'check_ui_messages' to inspect transient UI messages (toast/snackbar/alert) that may appear and disappear quickly.
    - If you are stuck, repeating actions, or not making progress, you MUST call 'check_network' and 'check_console' before trying more blind retries.
    - If the UI suggests an operation happened but no clear result is visible, call 'check_ui_messages' as well to detect transient errors or warnings.

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

            const updates: any = {
                lastToolCall: normalizedToolCalls.length === 1 ? normalizedToolCalls[0] : { calls: normalizedToolCalls },
                noToolCallStreak: 0,
                networkLog: "",
                consoleLogs: "",
                uiSignals: ""
            };

            if (latestProgress) updates.tasks = latestProgress;
            return updates;
        }
    }

    const nextNoToolCallStreak = state.noToolCallStreak + 1;
    console.warn(`LLM did not invoke a tool (attempt ${nextNoToolCallStreak}/3).`);
    if (nextNoToolCallStreak >= 3) {
        return { isFinished: true, lastToolCall: null, noToolCallStreak: nextNoToolCallStreak, networkLog: "", consoleLogs: "", uiSignals: "" };
    }

    return { isFinished: false, lastToolCall: null, noToolCallStreak: nextNoToolCallStreak, networkLog: "", consoleLogs: "", uiSignals: "" };
}