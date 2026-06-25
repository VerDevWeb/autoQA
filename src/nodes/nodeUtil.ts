import type { Page } from "playwright";

export let currentPage: Page;

export function setPageForNodes(page: Page): void {
    currentPage = page;
}

// Look for "wait X seconds" in the objective and return the seconds, or null
export function extractWaitSeconds(objective: string): number | null {
    const match = objective.match(/wait\s*(\d+)\s*(?:seconds?|sec)/i);
    return match ? parseInt(match[1] ?? "", 10) || null : null;
}

// Remove the "Go to URL" part from the objective
export function stripGotoFromObjective(objective: string, url: string): string {
    const urlPattern = escapeRegex(url);
    const gotoRegex = new RegExp(`(?:go\\s*(?:to)?\\s*)?${urlPattern}[.,]?\\s*`, 'gi');
    return objective.replace(gotoRegex, "").replace(/\s+,/g, ",").replace(/,\s*,/g, ",").trim();
}

// Remove "wait X seconds" from the objective
export function stripWaitFromObjective(objective: string): string {
    return objective.replace(/wait\s*\d+\s*(?:seconds?|sec)[.,]?\s*/gi, "")
        .replace(/\s+,/g, ",").replace(/,\s*,/g, ",").trim();
}

export function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Find a line in the checklist that matches taskName (if provided) or one of the keywords and mark it [x]
export function autoMarkTask(tasks: string, keywords: string[], taskName?: string): string {
    if (!tasks) return tasks;
    const lines = tasks.split('\n');
    let found = false;
    const updated = lines.map(line => {
        if (found) return line;
        const isUnchecked = line.match(/-\s*\[\s*\]/);
        if (!isUnchecked) return line;
        const lower = line.toLowerCase();
        // If taskName is provided, exact match on that string
        if (taskName) {
            if (lower.includes(taskName.toLowerCase())) {
                found = true;
                console.log(`[Task] Auto-marcato [x] (match esatto): ${line.trim()}`);
                return line.replace(/-\s*\[\s*\]/, '- [x]');
            }
            return line;
        }
        // Otherwise match by keyword
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


export function actionKind(entry: string): string {
    const lower = (entry || "").toLowerCase().trim();
    if (!lower) return "";
    if (lower.startsWith("click")) return "click";
    if (lower.startsWith("fill")) return "fill";
    if (lower.startsWith("select")) return "select";
    if (lower.startsWith("enter")) return "enter";
    if (lower.startsWith("goto")) return "goto";
    if (lower.startsWith("check_network")) return "check_network";
    if (lower.startsWith("check_console")) return "check_console";
    if (lower.startsWith("check_ui_messages")) return "check_ui_messages";
    if (lower.startsWith("wait")) return "wait";
    return lower.split(" ")[0] || lower;
}

export function hasRepetitiveLoop(actionHistory: string[]): boolean {
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