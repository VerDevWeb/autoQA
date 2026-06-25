import type { Page } from "playwright";

type UiSignalEntry = {
    kind: string;
    source: string;
    text: string;
    timestamp: number;
};

let entries: UiSignalEntry[] = [];
let capturing = false;

function normalizeText(value: string): string {
    return (value || "").replace(/\s+/g, " ").trim();
}

function classifyKind(text: string, source: string): string {
    const sample = `${text} ${source}`.toLowerCase();
    if (/(error|failed|failure|invalid|denied|forbidden|unable|not allowed|exception)/.test(sample)) return "error";
    if (/(warn|warning|caution|rate limit|too many requests)/.test(sample)) return "warning";
    if (/(success|saved|completed|done|created|updated|ok)/.test(sample)) return "success";
    return "info";
}

function addEntry(entry: UiSignalEntry): void {
    const normalized = normalizeText(entry.text);
    if (!normalized) return;

    const duplicate = entries.find((e) => e.text === normalized && e.source === entry.source && Math.abs(e.timestamp - entry.timestamp) < 2000);
    if (duplicate) return;

    entries.push({ ...entry, text: normalized });
    if (entries.length > 300) {
        entries = entries.slice(-300);
    }
}

export async function startUiSignalCapture(page: Page): Promise<void> {
    if (capturing) return;
    capturing = true;

    const bindingName = "__autoqaCaptureUiSignal";

    await page.exposeBinding(bindingName, async (_source, payload: any) => {
        try {
            const text = normalizeText(String(payload?.text || ""));
            const source = normalizeText(String(payload?.source || "ui"));
            if (!text) return;

            const kind = classifyKind(text, source);
            addEntry({
                kind,
                source,
                text,
                timestamp: Date.now(),
            });
        } catch {
            // Ignore malformed payloads coming from page scripts.
        }
    });

    await page.addInitScript((binding: string) => {
        const w = window as any;
        const send = (source: string, text: string) => {
            try {
                if (!text || typeof w[binding] !== "function") return;
                w[binding]({ source, text });
            } catch {
                // Ignore page-level errors during signal forwarding.
            }
        };

        const normalize = (value: string) => (value || "").replace(/\s+/g, " ").trim();
        const seen = new Map<string, number>();

        const shouldCapture = (el: Element): boolean => {
            const role = (el.getAttribute("role") || "").toLowerCase();
            const ariaLive = (el.getAttribute("aria-live") || "").toLowerCase();
            const cls = ((el as HTMLElement).className || "").toString().toLowerCase();
            const id = (el.id || "").toLowerCase();

            if (["alert", "status", "log"].includes(role)) return true;
            if (["assertive", "polite"].includes(ariaLive)) return true;
            if (/(toast|snack|alert|error|warning|success|notification|banner|message)/.test(cls)) return true;
            if (/(toast|snack|alert|error|warning|success|notification|banner|message)/.test(id)) return true;
            return false;
        };

        const captureElement = (el: Element, source: string) => {
            if (!(el instanceof HTMLElement)) return;
            if (!shouldCapture(el)) return;

            const text = normalize(el.innerText || el.textContent || "");
            if (!text || text.length < 3) return;

            const key = `${source}|${text}`;
            const now = Date.now();
            const previous = seen.get(key) || 0;
            if (now - previous < 1500) return;
            seen.set(key, now);
            send(source, text);
        };

        const captureNodeText = (node: Node, source: string) => {
            if (!(node instanceof HTMLElement)) return;
            captureElement(node, source);
            node.querySelectorAll("[role='alert'], [role='status'], [role='log'], [aria-live], [class*='toast'], [class*='snack'], [class*='alert'], [class*='error'], [class*='warning'], [class*='success'], [class*='notification'], [class*='banner'], [class*='message']")
                .forEach((el) => captureElement(el, source));
        };

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === "childList") {
                    mutation.addedNodes.forEach((node) => captureNodeText(node, "ui-appeared"));
                    mutation.removedNodes.forEach((node) => {
                        if (!(node instanceof HTMLElement)) return;
                        const text = normalize(node.innerText || node.textContent || "");
                        if (text.length >= 3) send("ui-disappeared", text);
                    });
                }

                if (mutation.type === "characterData") {
                    const parent = mutation.target.parentElement;
                    if (parent) captureElement(parent, "ui-updated");
                }

                if (mutation.type === "attributes") {
                    const target = mutation.target;
                    if (target instanceof HTMLElement) captureElement(target, "ui-attributes");
                }
            }
        });

        const startObserver = () => {
            const root = document.documentElement || document.body;
            if (!root) return;
            observer.observe(root, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: ["class", "style", "aria-live", "role", "hidden", "aria-hidden"],
            });
        };

        const fullScan = () => {
            document
                .querySelectorAll("[role='alert'], [role='status'], [role='log'], [aria-live], [class*='toast'], [class*='snack'], [class*='alert'], [class*='error'], [class*='warning'], [class*='success'], [class*='notification'], [class*='banner'], [class*='message']")
                .forEach((el) => captureElement(el, "ui-scan"));
        };

        startObserver();
        if (document.readyState === "complete") {
            fullScan();
            setTimeout(fullScan, 600);
            setTimeout(fullScan, 1600);
        } else {
            window.addEventListener("load", () => {
                fullScan();
                setTimeout(fullScan, 600);
                setTimeout(fullScan, 1600);
            }, { once: true });
        }

        document.addEventListener("submit", () => {
            setTimeout(fullScan, 120);
            setTimeout(fullScan, 900);
        }, true);
    }, bindingName);
}

export function getUiSignalsLog(): string {
    if (entries.length === 0) return "No transient UI messages captured.";

    const recent = entries.slice(-50);
    const lines = recent.map((entry) => {
        const time = new Date(entry.timestamp).toLocaleTimeString("it-IT");
        return `[${time}] [${entry.kind.toUpperCase()}] [${entry.source}] ${entry.text}`;
    });

    return lines.join("\n");
}

export function clearUiSignalsLog(): void {
    entries = [];
}
