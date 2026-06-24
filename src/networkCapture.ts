import type { Page } from "playwright";

type NetworkEntry = {
    url: string;
    method: string;
    status: number | null;
    statusText: string;
    error: string | null;
    timestamp: number;
    resourceType: string;
};

let entries: NetworkEntry[] = [];
let capturing = false;

export function startNetworkCapture(page: Page): void {
    if (capturing) return;
    capturing = true;

    page.on('response', (response) => {
        const url = response.url();
        const method = response.request().method();
        const resourceType = response.request().resourceType();

        // Solo fetch/XHR/document - niente immagini, css, font, ecc.
        const relevantTypes = ['xhr', 'fetch', 'document', 'websocket'];
        if (!relevantTypes.includes(resourceType)) return;
        if (method === 'OPTIONS') return;

        addEntry({
            url: truncateUrl(url),
            method,
            status: response.status(),
            statusText: response.statusText(),
            error: null,
            timestamp: Date.now(),
            resourceType,
        });
    });

    page.on('requestfailed', (request) => {
        const resourceType = request.resourceType();
        const relevantTypes = ['xhr', 'fetch', 'document', 'websocket'];
        if (!relevantTypes.includes(resourceType)) return;

        addEntry({
            url: truncateUrl(request.url()),
            method: request.method(),
            status: null,
            statusText: '',
            error: request.failure()?.errorText || 'Unknown error',
            timestamp: Date.now(),
            resourceType,
        });
    });
}

function truncateUrl(url: string, max: number = 600): string {
    return url.length > max ? url.slice(0, max) + '...' : url;
}

function addEntry(entry: NetworkEntry): void {
    entries.push(entry);
    if (entries.length > 100) {
        entries = entries.slice(-100);
    }
}

export function getNetworkLog(): string {
    if (entries.length === 0) return "Nessuna richiesta di rete registrata.";

    const recent = entries.slice(-30);
    const lines = recent.map((e) => {
        const time = new Date(e.timestamp).toLocaleTimeString('it-IT');
        const status = e.status ? `${e.status} ${e.statusText}` : 'ERRORE';
        const icon = e.error ? '❌' : (e.status && e.status >= 400 ? '⚠️' : '✅');
        const type = e.resourceType === 'document' ? '📄' : '🔄';
        const errorMsg = e.error ? ` - ${e.error}` : '';
        return `${icon}${type} [${time}] ${e.method} ${status} ${e.url}${errorMsg}`;
    });

    return lines.join('\n');
}

export function clearNetworkLog(): void {
    entries = [];
}
