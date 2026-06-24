import type { Page, Locator } from "playwright";
import type { AgentState } from "./types.js";
import { parseDomAst, escapeRegex } from "./ast.js";

let currentPage: Page;

export function setPageInstance(page: Page): void {
    currentPage = page;
}

async function pickFirstVisible(locator: Locator, maxCandidates = 6): Promise<Locator | null> {
    const count = await locator.count();
    const limit = Math.min(count, maxCandidates);
    for (let i = 0; i < limit; i++) {
        const candidate = locator.nth(i);
        try {
            if (await candidate.isVisible()) {
                return candidate;
            }
        } catch {
            // candidate became stale, continue
        }
    }
    return null;
}

/*
    This function resolves an agent element id

    Pipeline:
    executeNode calls the resolveLocatorWithFallback giving to it the current agent state and the agent element id in order to convert this into real html attributes that are related to the element 
*/
export async function resolveLocatorWithFallback(state: AgentState, agentId: string): Promise<Locator> {
    const primary = currentPage.locator(`[data-agent-id="${agentId}"]`);
    if (await primary.count() > 0) {
        const visiblePrimary = await pickFirstVisible(primary);
        if (visiblePrimary) {
            return visiblePrimary;
        }
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
            const visibleByContains = await pickFirstVisible(byContains);
            if (visibleByContains) {
                return visibleByContains;
            }
        }
    }

    const placeholder = target.attributes?.placeholder;
    if (placeholder) {
        const byPlaceholder = currentPage.getByPlaceholder(placeholder, { exact: false });
        if (await byPlaceholder.count() > 0) {
            const visibleByPlaceholder = await pickFirstVisible(byPlaceholder);
            if (visibleByPlaceholder) {
                return visibleByPlaceholder;
            }
        }
    }

    const ariaLabel = target.attributes?.["aria-label"];
    if (ariaLabel) {
        const byLabel = currentPage.getByLabel(ariaLabel, { exact: false });
        if (await byLabel.count() > 0) {
            const visibleByLabel = await pickFirstVisible(byLabel);
            if (visibleByLabel) {
                return visibleByLabel;
            }
        }
    }

    throw new Error(`Unable to resolve locator for ${agentId} (ID no longer valid and text fallback failed).`);
}
