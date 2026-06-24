import type { Page } from "playwright";
import type { AstElement } from "./types.js";

/*
    This function extract simplified DOM with all necessary information for the agent in order to "see" the page and have the necessary context to execute actions on the page such as clicks
*/
export async function extractSimplifiedDOM(page: Page): Promise<string> {
    return await page.evaluate(() => {
        let counter = 0;
        const elements: any[] = [];
        const selector = 'a, button, input, select, textarea, [role="button"], [onclick], [cursor="pointer"]';
        const interactables = document.querySelectorAll(selector);

        const bodyText = document.body?.innerText || '';
        const bodyWords = bodyText.trim() ? bodyText.trim().split(/\s+/).length : 0;
        const compactMode = bodyWords > 1200;
        const maxWordsPerElement = 20;

        interactables.forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

            const id = `agent-el-${counter++}`;
            el.setAttribute('data-agent-id', id);

            const attributes: Record<string, string> = {};
            for (let i = 0; i < el.attributes.length; i++) {
                const attr = el.attributes[i];
                if (attr && attr.name !== 'data-agent-id') {
                    attributes[attr.name] = attr.value;
                }
            }

            let visualText = (el as HTMLElement).innerText?.trim() || '';
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                visualText = (el as HTMLInputElement).value || el.getAttribute('placeholder') || '';
            }

            if (compactMode) {
                const clean = visualText.replace(/\s+/g, ' ').trim();
                if (clean) {
                    const words = clean.split(' ');
                    visualText = words.length <= maxWordsPerElement
                        ? clean
                        : `${words.slice(0, maxWordsPerElement).join(' ')} ...`;
                } else {
                    visualText = '';
                }
            }

            elements.push({
                agentId: id,
                tagName: el.tagName.toLowerCase(),
                text: visualText,
                attributes: attributes
            });
        });

        return JSON.stringify(elements, null, 2);
    });
}

export function parseDomAst(domAst: string): AstElement[] {
    try {
        const parsed = JSON.parse(domAst);
        if (!Array.isArray(parsed)) return [];
        return parsed as AstElement[];
    } catch {
        return [];
    }
}

export function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitizeCompactText(value: string): string {
    return value.replace(/[\r\n|]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function buildCompactAstForPrompt(domAst: string): string {
    const elements = parseDomAst(domAst);
    if (elements.length === 0) {
        return "";
    }

    return elements.map((el) => {
        const txt = sanitizeCompactText(el.text || "").slice(0, 180);
        const attr = el.attributes || {};

        const extras: string[] = [];
        const type = sanitizeCompactText(attr.type || "");
        const role = sanitizeCompactText(attr.role || "");
        const placeholder = sanitizeCompactText(attr.placeholder || "").slice(0, 80);
        const ariaLabel = sanitizeCompactText(attr["aria-label"] || "").slice(0, 80);
        const name = sanitizeCompactText(attr.name || "").slice(0, 60);

        if (type) extras.push(`t=${type}`);
        if (role) extras.push(`r=${role}`);
        if (placeholder) extras.push(`ph=${placeholder}`);
        if (ariaLabel) extras.push(`aria=${ariaLabel}`);
        if (name) extras.push(`n=${name}`);

        const extrasBlock = extras.length > 0 ? `|${extras.join("|")}` : "";
        return `${el.agentId}|${el.tagName}|${txt}${extrasBlock}`;
    }).join("\n");
}

function isContextDestroyedError(error: unknown): boolean {
    const message = (error as Error)?.message ?? String(error);
    return message.includes("Execution context was destroyed")
        || message.includes("Cannot find context with specified id")
        || message.includes("Most likely the page has been closed");
}

export async function extractSimplifiedDOMWithRetry(page: Page, maxAttempts = 4): Promise<string> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await page.waitForLoadState("domcontentloaded", { timeout: 4000 }).catch(() => undefined);
            return await extractSimplifiedDOM(page);
        } catch (error) {
            if (!isContextDestroyedError(error) || attempt === maxAttempts) {
                throw error;
            }

            await page.waitForLoadState("domcontentloaded", { timeout: 4000 }).catch(() => undefined);
            await new Promise(resolve => setTimeout(resolve, 250));
        }
    }

    throw new Error("Impossibile estrarre il DOM dopo più tentativi.");
}
