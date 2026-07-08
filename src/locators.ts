import type { Page, Locator } from "playwright";
import type { AgentState, ElementTarget } from "./types.js";
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

function qAttr(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function sanitizeTarget(target: ElementTarget): ElementTarget {
    const cleaned: ElementTarget = {};
    const keys: (keyof ElementTarget)[] = ["css", "tag", "id", "name", "type", "placeholder", "ariaLabel", "role", "href", "text", "label"];
    for (const key of keys) {
        const raw = target[key];
        if (typeof raw !== "string") continue;
        const v = raw.trim();
        if (v) cleaned[key] = v;
    }
    return cleaned;
}

async function tryVisible(locator: Locator): Promise<Locator | null> {
    if (await locator.count() === 0) return null;
    return await pickFirstVisible(locator);
}

async function resolveByTarget(target: ElementTarget): Promise<Locator | null> {
    const hints = sanitizeTarget(target);

    if (hints.css) {
        const byCss = await tryVisible(currentPage.locator(hints.css));
        if (byCss) return byCss;
    }

    if (hints.id) {
        const byId = await tryVisible(currentPage.locator(`[id="${qAttr(hints.id)}"]`));
        if (byId) return byId;
    }

    if (hints.placeholder) {
        const byPlaceholder = await tryVisible(currentPage.getByPlaceholder(hints.placeholder, { exact: false }));
        if (byPlaceholder) return byPlaceholder;
    }

    if (hints.ariaLabel) {
        const byLabel = await tryVisible(currentPage.getByLabel(hints.ariaLabel, { exact: false }));
        if (byLabel) return byLabel;
    }

    if (hints.role) {
        const byRole = await tryVisible(currentPage.getByRole(hints.role as any, hints.text ? { name: new RegExp(escapeRegex(hints.text), "i") } : undefined));
        if (byRole) return byRole;
    }

    if (hints.name) {
        const tag = hints.tag || "*";
        const byName = await tryVisible(currentPage.locator(`${tag}[name="${qAttr(hints.name)}"]`));
        if (byName) return byName;
    }

    if (hints.href) {
        const byHref = await tryVisible(currentPage.locator(`a[href*="${qAttr(hints.href)}"]`));
        if (byHref) return byHref;
    }

    if (hints.text) {
        const textRegex = new RegExp(escapeRegex(hints.text), "i");
        const tag = hints.tag || "*";
        const byText = await tryVisible(currentPage.locator(tag).filter({ hasText: textRegex }));
        if (byText) return byText;
    }

    if (hints.label) {
        const byLabelText = await tryVisible(currentPage.getByLabel(hints.label, { exact: false }));
        if (byLabelText) return byLabelText;
    }

    if (hints.tag) {
        const byTag = await tryVisible(currentPage.locator(hints.tag));
        if (byTag) return byTag;
    }

    return null;
}

/*
    This function resolves an agent element id

    Pipeline:
    executeNode calls the resolveLocatorWithFallback giving to it the current agent state and the agent element id in order to convert this into real html attributes that are related to the element 
*/
export async function resolveLocatorWithFallback(state: AgentState, targetRef: string | ElementTarget): Promise<Locator> {
    if (typeof targetRef !== "string") {
        const byTarget = await resolveByTarget(targetRef);
        if (byTarget) {
            return byTarget;
        }
    }

    const agentId = typeof targetRef === "string" ? targetRef : "";
    if (!agentId) {
        throw new Error("Unable to resolve locator: missing target hints and missing legacy agentId.");
    }

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
