import type { Page } from "playwright";

type NetworkEntry = {
    url: string;
    method: string;
    status: number | null;
    statusText: string;
    error: string | null;
    timestamp: number;
    bodySize: number | null;
    contentType: string | null;
};

let entries: NetworkEntry[] = [];
let capturing = false;

export function startNetworkCapture(page: Page): void {
    if (capturing) return;
    capturing = true;

    page.on('response', async (response) => {
        const url = response.url();
        const method = response.request().method();
        const status = response.status();
        const statusText = response.statusText();
        const contentType = response.headers()['content-type'] || null;

        // Filtra solo richieste rilevanti (fetch, XHR, document)
        const isRelevant = method !== 'OPTIONS'
            && (url.startsWith('http') || url.startsWith('https'));
        if (!isRelevant) return;

        let bodySize: number | null = null;
        try {
            const body = await response.body().catch(() => null);
            if (body) bodySize = body.length;
        } catch { }

        addEntry({
            url: truncateUrl(url, 200),
            method,
            status,
            statusText,
            error: null,
            timestamp: Date.now(),
            bodySize,
            contentType: contentType ? (contentType.split(';')[0] ?? '').trim() || null : null,
        });
    });

    page.on('requestfailed', (request) => {
        const url = request.url();
        const method = request.method();
        const error = request.failure()?.errorText || 'Unknown error';

        addEntry({
            url: truncateUrl(url, 200),
            method,
            status: null,
            statusText: '',
            error,
            timestamp: Date.now(),
            bodySize: null,
            contentType: null,
        });
    });
}

function truncateUrl(url: string, max: number): string {
    return url.length > max ? url.slice(0, max) + '...' : url;
}

function addEntry(entry: NetworkEntry): void {
    entries.push(entry);
    // Mantiene solo le ultime 100 entries
    if (entries.length > 100) {
        entries = entries.slice(-100);
    }
}

export function getNetworkLog(): string {
    if (entries.length === 0) return "Nessuna richiesta di rete registrata.";

    const recent = entries.slice(-30); // ultime 30

    const lines = recent.map((e, i) => {
        const time = new Date(e.timestamp).toLocaleTimeString('it-IT');
        const status = e.status ? `${e.status} ${e.statusText}` : 'ERRORE';
        const icon = e.error ? '❌' : (e.status && e.status >= 400 ? '⚠️' : '✅');
        const size = e.bodySize !== null ? ` (${formatBytes(e.bodySize)})` : '';
        const type = e.contentType || '';
        const errorMsg = e.error ? ` - ${e.error}` : '';
        return `${icon} [${time}] ${e.method} ${status} ${e.url}${size}${type}${errorMsg}`;
    });

    return lines.join('\n');
}

export function clearNetworkLog(): void {
    entries = [];
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
