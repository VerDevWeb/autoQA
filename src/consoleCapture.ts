import type { Page } from "playwright";

type ConsoleEntry = {
    type: string;
    text: string;
    timestamp: number;
};

let entries: ConsoleEntry[] = [];
let capturing = false;

export function startConsoleCapture(page: Page): void {
    if (capturing) return;
    capturing = true;

    page.on("console", (msg) => {
        const text = msg.text();
        if (!text || text.trim() === "") return;

        addEntry({
            type: msg.type(),
            text: text.trim(),
            timestamp: Date.now(),
        });
    });

    page.on("pageerror", (err) => {
        addEntry({
            type: "error",
            text: `Uncaught: ${err.message}`,
            timestamp: Date.now(),
        });
    });
}

function addEntry(entry: ConsoleEntry): void {
    entries.push(entry);
    if (entries.length > 200) {
        entries = entries.slice(-200);
    }
}

export function getConsoleLog(): string {
    if (entries.length === 0) return "Nessun messaggio console registrato.";

    const recent = entries.slice(-50);
    const lines = recent.map((e) => {
        const time = new Date(e.timestamp).toLocaleTimeString("it-IT");
        const icon =
            e.type === "error" ? "ERROR: " :
            e.type === "warn" ? "WARNING: " :
            e.type === "warning" ? "WARNING: " : "LOG: ";
        return `${icon} [${time}] [${e.type.toUpperCase()}] ${e.text}`;
    });

    return lines.join("\n");
}

export function getRecentConsoleIssues(lookbackMs = 15000, maxItems = 10): string {
    const now = Date.now();
    const issues = entries
        .filter((e) => now - e.timestamp <= lookbackMs)
        .filter((e) => e.type === "error" || e.type === "warn" || e.type === "warning")
        .slice(-maxItems);

    if (issues.length === 0) {
        return "";
    }

    return issues.map((e) => {
        const time = new Date(e.timestamp).toLocaleTimeString("it-IT");
        return `[${time}] [${e.type.toUpperCase()}] ${e.text}`;
    }).join("\n");
}

export function clearConsoleLog(): void {
    entries = [];
}
