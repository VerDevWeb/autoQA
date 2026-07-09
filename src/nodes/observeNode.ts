import type { AgentState } from "../types.js";
import { extractSimplifiedDOMWithRetry } from "../ast.js";
import { getRecentNetworkIssues } from "../networkCapture.js";
import { getRecentConsoleIssues } from "../consoleCapture.js";
import { currentPage } from "./nodeUtil.js";


export async function observeNode(state: AgentState): Promise<Partial<AgentState>> {
    console.log("-> [Observe] Analyzing current DOM...");
    await Promise.race([
        currentPage.waitForLoadState("load"),
        new Promise(resolve => setTimeout(resolve, 3000))
    ]);
    const currentUrl = currentPage.url();
    const domAst = await extractSimplifiedDOMWithRetry(currentPage);
    const realtimeNetworkAlerts = getRecentNetworkIssues();
    const realtimeConsoleAlerts = getRecentConsoleIssues();

    return { currentUrl, domAst, realtimeNetworkAlerts, realtimeConsoleAlerts };
}
