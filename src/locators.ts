import type { Page, Locator } from "playwright";
<<<<<<< HEAD
=======
import type { AgentState } from "./types.js";
import { parseDomAst, escapeRegex } from "./ast.js";
>>>>>>> 9afb263 (code refactor => divided index.ts into single files, each file's function or content is explained in the README.ts)

let currentPage: Page;

export function setPageInstance(page: Page): void {
    currentPage = page;
}

<<<<<<< HEAD
export async function resolveLocator(
    tag: string,
    text?: string,
    attrs?: Record<string, string>
): Promise<Locator> {
    let css = tag;
    if (attrs) {
        for (const [key, val] of Object.entries(attrs)) {
            const escaped = val.replace(/"/g, '\\"');
            css += `[${key}="${escaped}"]`;
        }
    }

    let locator = currentPage.locator(css);
    if (await locator.count() > 0) {
        return locator.first();
    }

    if (text) {
        locator = currentPage.locator(tag).filter({ hasText: text });
        if (await locator.count() > 0) {
            return locator.first();
        }
    }

    if (text && text.length >= 3) {
        locator = currentPage.locator('*').filter({ hasText: text });
        if (await locator.count() > 0) {
            return locator.first();
        }
    }

    throw new Error(`Elemento non trovato: ${tag}${text ? ` "${text}"` : ''}`);
=======
export async function resolveLocatorWithFallback(state: AgentState, agentId: string): Promise<Locator> {
    const primary = currentPage.locator(`[data-agent-id="${agentId}"]`);
    if (await primary.count() > 0) {
        return primary.first();
    }

    const astElements = parseDomAst(state.domAst);
    const target = astElements.find((el) => el.agentId === agentId);
    if (!target) {
        throw new Error(`Elemento ${agentId} non trovato nell'AST corrente.`);
    }

    const normalizedText = (target.text || '').replace(/\s+/g, ' ').trim();
    if (normalizedText.length >= 3) {
        const textRegex = new RegExp(escapeRegex(normalizedText), 'i');
        const byContains = currentPage.locator(target.tagName).filter({ hasText: textRegex });
        if (await byContains.count() > 0) {
            return byContains.first();
        }
    }

    const placeholder = target.attributes?.placeholder;
    if (placeholder) {
        const byPlaceholder = currentPage.getByPlaceholder(placeholder, { exact: false });
        if (await byPlaceholder.count() > 0) {
            return byPlaceholder.first();
        }
    }

    const ariaLabel = target.attributes?.["aria-label"];
    if (ariaLabel) {
        const byLabel = currentPage.getByLabel(ariaLabel, { exact: false });
        if (await byLabel.count() > 0) {
            return byLabel.first();
        }
    }

    throw new Error(`Impossibile risolvere il locator per ${agentId} (ID non più valido e fallback testuale fallito).`);
>>>>>>> 9afb263 (code refactor => divided index.ts into single files, each file's function or content is explained in the README.ts)
}
