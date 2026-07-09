import type { Page } from "playwright";
import type { AstElement } from "./types.js";

/*
    This function extract simplified DOM with all necessary information for the agent in order to "see" the page and have the necessary context to execute actions on the page such as clicks
    Each element includes: agentId, tagName, text (value/placeholder for inputs), attributes, and a label field with surrounding context (aria-labelledby, <label for>, aria-describedby, parent label, previous sibling, parent text)
*/
export async function extractSimplifiedDOM(page: Page): Promise<string> {
    return await page.evaluate(
        function (): string {
            let counter = 0;
            const elements: { agentId: string; tagName: string; text: string; attributes: Record<string, string>; label: string; ancestors: string[] }[] = [];
            const selector = 'a, button, input, select, textarea, details, summary, label, dialog, [role="button"], [role="listbox"], [role="option"], [role="menuitem"], [role="combobox"], [role="tab"], [role="link"], [onclick], [cursor="pointer"], [contenteditable], [tabindex]:not([tabindex="-1"])';
            const interactables = document.querySelectorAll(selector);

            const bodyText = document.body?.innerText || "";
            const bodyWords = bodyText.trim() ? bodyText.trim().split(/\s+/).length : 0;
            const compactMode = bodyWords > 1200;
            const maxWordsPerElement = 35;

            const toZIndex = (el: Element): number => {
                const raw = window.getComputedStyle(el).zIndex;
                const n = Number.parseInt(raw || "0", 10);
                return Number.isFinite(n) ? n : 0;
            };

            const modalCandidates = Array.from(document.querySelectorAll(
                'dialog[open], [role="dialog"][aria-modal="true"], [aria-modal="true"], [role="alertdialog"], [class*="modal"], [id*="modal"], [class*="cookie"], [id*="cookie"], [class*="consent"], [id*="consent"]'
            )).filter((node) => {
                const rect = (node as HTMLElement).getBoundingClientRect();
                if (rect.width < 80 || rect.height < 50) return false;
                const style = window.getComputedStyle(node as HTMLElement);
                return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
            });

            const activeModalRoot = modalCandidates.length > 0
                ? modalCandidates.sort((a, b) => toZIndex(b) - toZIndex(a))[0]
                : null;

            const isTopLayerReachable = (el: Element, rect: DOMRect): boolean => {
                const points: Array<[number, number]> = [
                    [rect.left + rect.width * 0.5, rect.top + rect.height * 0.5],
                    [rect.left + rect.width * 0.25, rect.top + rect.height * 0.25],
                    [rect.left + rect.width * 0.75, rect.top + rect.height * 0.75],
                ];

                const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

                for (const [px, py] of points) {
                    const x = clamp(px, 0, Math.max(window.innerWidth - 1, 0));
                    const y = clamp(py, 0, Math.max(window.innerHeight - 1, 0));
                    const topNode = document.elementFromPoint(x, y);
                    if (!topNode) continue;
                    if (topNode === el || el.contains(topNode) || (topNode instanceof Element && topNode.contains(el))) {
                        return true;
                    }
                }

                return false;
            };

            interactables.forEach((el: Element) => {
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) return;
                const style = window.getComputedStyle(el);
                if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return;
                if (style.pointerEvents === "none") return;

                // If a modal/popup is active, ignore actionable elements outside that top layer.
                if (activeModalRoot && !activeModalRoot.contains(el)) return;

                // Ignore elements hidden behind overlays or blocked by top-layer siblings.
                if (!isTopLayerReachable(el, rect)) return;

                const id = "agent-el-" + (counter++);
                el.setAttribute("data-agent-id", id);

                const attributes: Record<string, string> = {};
                for (let i = 0; i < el.attributes.length; i++) {
                    const attr = el.attributes[i];
                    if (attr && attr.name !== "data-agent-id" && !attr.name.startsWith("_ngcontent") && !attr.name.startsWith("_nghost")) {
                        attributes[attr.name] = attr.value;
                    }
                }

                let visualText = (el as HTMLElement).innerText?.trim() || "";
                if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
                    visualText = (el as HTMLInputElement).value || el.getAttribute("placeholder") || "";
                }
                if (el.tagName === "SELECT") {
                    const selectEl = el as HTMLSelectElement;
                    const optionPairs: string[] = [];
                    for (const opt of Array.from(selectEl.options)) {
                        const optLabel = (opt.textContent || "").replace(/\s+/g, " ").trim();
                        const optValue = (opt.value || "").replace(/\s+/g, " ").trim();
                        if (!optLabel && !optValue) continue;
                        optionPairs.push(`${optValue}=>${optLabel}`);
                    }

                    if (optionPairs.length > 0) {
                        attributes.options = optionPairs.slice(0, 40).join(" | ");
                    }

                    const selected = selectEl.value?.trim();
                    if (selected) {
                        attributes.selected = selected;
                    }
                }

                if (compactMode) {
                    const clean = visualText.replace(/\s+/g, " ").trim();
                    if (clean) {
                        const words = clean.split(" ");
                        visualText = words.length <= maxWordsPerElement
                            ? clean
                            : words.slice(0, maxWordsPerElement).join(" ") + " ...";
                    } else {
                        visualText = "";
                    }
                }

                // Derive label/context
                let label = "";
                const labelledby = el.getAttribute("aria-labelledby");
                if (labelledby) {
                    const ref = document.getElementById(labelledby);
                    if (ref?.textContent?.trim()) label = ref.textContent.trim();
                }
                if (!label) {
                    const describedby = el.getAttribute("aria-describedby");
                    if (describedby) {
                        const ref = document.getElementById(describedby);
                        if (ref?.textContent?.trim()) label = ref.textContent.trim();
                    }
                }
                if (!label) {
                    const elId = el.getAttribute("id");
                    if (elId) {
                        const lbl = document.querySelector(`label[for="${elId}"]`);
                        if (lbl?.textContent?.trim()) label = lbl.textContent.trim();
                    }
                }
                if (!label) {
                    const parentLabel = el.closest("label");
                    if (parentLabel?.textContent?.trim()) {
                        label = parentLabel.textContent.replace(el.textContent || "", "").trim();
                    }
                }
                if (!label) {
                    const prev = el.previousElementSibling;
                    if (prev && ["SPAN", "DIV", "LABEL", "SMALL", "P", "H1", "H2", "H3", "H4", "H5", "H6", "STRONG", "FIELDSET", "LEGEND"].includes(prev.tagName)) {
                        const text = (prev as HTMLElement).innerText?.trim();
                        if (text && text.length < 200) label = text;
                    }
                }
                if (!label) {
                    const parent = el.parentElement;
                    if (parent) {
                        const parentText = parent.textContent.replace(el.textContent || "", "").trim() || "";
                        if (parentText && parentText.length < 200) {
                            const lines = parentText.split("\n").filter(l => l.trim()).map(l => l.trim());
                            label = lines.slice(0, 3).join(" | ");
                        }
                    }
                }

                // Build ancestor chain inline to avoid named helpers that may break in page.evaluate transpilation.
                const ancestors: string[] = [];
                let cur: Element | null = el.parentElement;
                while (cur && cur.tagName !== "BODY" && cur.tagName !== "HTML") {
                    const tag = cur.tagName.toLowerCase();
                    const significant = ["form", "fieldset", "section", "article", "main", "nav", "aside", "dialog"].includes(tag)
                        || (tag === "div" && Boolean(
                            cur.getAttribute("id")
                            || cur.getAttribute("class")
                            || cur.getAttribute("role")
                            || cur.getAttribute("aria-label")
                        ));

                    if (significant) {
                        const id = cur.getAttribute("id");
                        const cls = (cur.getAttribute("class") || "")
                            .split(/\s+/)
                            .map((x) => x.trim())
                            .filter(Boolean)
                            .slice(0, 2)
                            .join(".");
                        const role = cur.getAttribute("role") || "";
                        const aria = cur.getAttribute("aria-label") || "";

                        let token = tag;
                        if (id) token += `#${id}`;
                        if (cls) token += `.${cls}`;
                        if (role) token += `[role=${role}]`;
                        if (aria) token += `[aria-label=${aria.slice(0, 60)}]`;
                        ancestors.unshift(token);
                    }

                    cur = cur.parentElement;
                }

                elements.push({
                    agentId: id,
                    tagName: el.tagName.toLowerCase(),
                    text: visualText,
                    attributes: attributes,
                    label: label,
                    ancestors: ancestors.slice(-4)
                });
            });

            return JSON.stringify(elements, null, 2);
        }
    );
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

function escapeSExpr(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, " ");
}

function serializeKeyAttrs(attr: Record<string, string>): string {
    const keys = ["id", "type", "name", "placeholder", "aria-label", "role", "value", "selected", "options", "href", "src"];
    const chunks: string[] = [];

    for (const key of keys) {
        const raw = attr[key];
        if (!raw) continue;
        const value = escapeSExpr(raw.slice(0, 140));
        chunks.push(`${key}="${value}"`);
    }

    return chunks.join(" ");
}

type ClassAliasState = {
    byClass: Map<string, string>;
    nextId: number;
};

type IdAliasState = {
    byId: Map<string, string>;
    nextId: number;
};

function getClassAlias(className: string, state: ClassAliasState): string {
    const key = className.trim();
    if (!key) return "";
    const existing = state.byClass.get(key);
    if (existing) return existing;
    const alias = `class${state.nextId++}`;
    state.byClass.set(key, alias);
    return alias;
}

function aliasClassToken(value: string, state: ClassAliasState, maxClasses = 2): string {
    return value
        .split(/\s+/)
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, maxClasses)
        .map((className) => getClassAlias(className, state))
        .filter(Boolean)
        .join(".");
}

function getIdAlias(idValue: string, state: IdAliasState): string {
    const key = idValue.trim();
    if (!key) return "";
    const existing = state.byId.get(key);
    if (existing) return existing;
    const alias = `id${state.nextId++}`;
    state.byId.set(key, alias);
    return alias;
}

function aliasClassesInAncestorToken(token: string, state: ClassAliasState): string {
    return token.replace(/\.([a-zA-Z0-9_-]+)/g, (_m, cls: string) => {
        const alias = getClassAlias(cls, state);
        return alias ? `.${alias}` : "";
    });
}

function aliasIdsInAncestorToken(token: string, state: IdAliasState): string {
    return token.replace(/#([a-zA-Z0-9_-]+)/g, (_m, idValue: string) => {
        const alias = getIdAlias(idValue, state);
        return alias ? `#${alias}` : "";
    });
}

function compactTagWithIdentity(
    tagName: string,
    attr: Record<string, string>,
    classAliases: ClassAliasState,
    idAliases: IdAliasState
): string {
    const id = attr.id ? `#${escapeSExpr(getIdAlias(attr.id.slice(0, 60), idAliases))}` : "";
    const cls = aliasClassToken(attr.class || "", classAliases, 2);
    const clsPart = cls ? `.${escapeSExpr(cls)}` : "";
    return `${tagName}${id}${clsPart}`;
}

function normalizePromptText(value: string): string {
    return (value || "").replace(/\s+/g, " ").trim();
}

function hasMeaningfulSignal(el: AstElement): boolean {
    const attrs = el.attributes || {};
    const text = normalizePromptText(el.text || "");
    const label = normalizePromptText(el.label || "");
    const hasKeyAttrs = Boolean(
        attrs.type
        || attrs.name
        || attrs.placeholder
        || attrs["aria-label"]
        || attrs.role
        || attrs.value
        || attrs.href
    );

    return text.length > 0 || label.length > 0 || hasKeyAttrs;
}

function elementPriority(el: AstElement): number {
    const tag = (el.tagName || "").toLowerCase();
    const type = (el.attributes?.type || "").toLowerCase();
    const role = (el.attributes?.role || "").toLowerCase();
    const text = normalizePromptText(el.text || "").toLowerCase();
    const label = normalizePromptText(el.label || "").toLowerCase();
    const sample = `${type} ${role} ${text} ${label}`;

    if (tag === "input" || tag === "select" || tag === "textarea") return 4;
    if (tag === "button" || role === "button") return 3;
    if (/(submit|invia|send|search|cerca|continue|confirm)/.test(sample)) return 3;
    if (tag === "a" || role === "link") return 2;
    return 1;
}

export function buildCompactAstForPrompt(domAst: string): string {
    const elements = parseDomAst(domAst);
    if (elements.length === 0) {
        return "";
    }

    type TreeNode = {
        token: string;
        children: Map<string, TreeNode>;
        leaves: string[];
    };

    const root: TreeNode = { token: "ROOT", children: new Map(), leaves: [] };
    const classAliases: ClassAliasState = { byClass: new Map(), nextId: 1 };
    const idAliases: IdAliasState = { byId: new Map(), nextId: 1 };

    const cleaned = elements
        .filter((el) => hasMeaningfulSignal(el))
        .sort((a, b) => elementPriority(b) - elementPriority(a));

    const leafSeen = new Set<string>();
    const leavesPerContainer = new Map<string, number>();
    const maxLeavesGlobal = 320;
    const maxLeavesPerContainer = 28;
    let globalLeaves = 0;

    for (const el of cleaned) {
        if (globalLeaves >= maxLeavesGlobal) break;

        const chain = (el.ancestors || [])
            .filter(Boolean)
            .slice(0, 4)
            .map((token) => aliasIdsInAncestorToken(aliasClassesInAncestorToken(token, classAliases), idAliases));
        const containerKey = chain.join(" > ") || "ROOT";
        const currentContainerCount = leavesPerContainer.get(containerKey) || 0;
        if (currentContainerCount >= maxLeavesPerContainer) continue;

        let current = root;

        for (const token of chain) {
            if (!current.children.has(token)) {
                current.children.set(token, { token, children: new Map(), leaves: [] });
            }
            const nextNode = current.children.get(token);
            if (!nextNode) break;
            current = nextNode;
        }

        const tag = compactTagWithIdentity(el.tagName || "div", el.attributes || {}, classAliases, idAliases);
        const attrs = serializeKeyAttrs(el.attributes || {});
        const normalizedLabel = normalizePromptText(el.label || "");
        const normalizedText = normalizePromptText(el.text || "");
        const label = normalizedLabel ? ` label="${escapeSExpr(normalizedLabel).slice(0, 140)}"` : "";
        const text = normalizedText ? ` text="${escapeSExpr(normalizedText).slice(0, 180)}"` : "";
        const attrPart = attrs ? ` ${attrs}` : "";
        const leaf = `${tag}${attrPart}${label}${text}`;

        // Drop near-duplicates with same semantics to keep the prompt focused.
        const duplicateKey = `${containerKey}|${tag}|${attrs}|${label}|${text}`;
        if (leafSeen.has(duplicateKey)) continue;
        leafSeen.add(duplicateKey);

        current.leaves.push(leaf);
        leavesPerContainer.set(containerKey, currentContainerCount + 1);
        globalLeaves += 1;
    }

    const lines: string[] = [];
    const emit = (node: TreeNode, depth: number): void => {
        if (node.token !== "ROOT") {
            lines.push(`${"  ".repeat(depth)}${node.token}`);
        }

        const leafIndent = "  ".repeat(node.token === "ROOT" ? depth : depth + 1);
        for (const leaf of node.leaves) {
            lines.push(`${leafIndent}${leaf}`);
        }

        for (const child of node.children.values()) {
            emit(child, node.token === "ROOT" ? depth : depth + 1);
        }
    };

    emit(root, 0);
    return lines.join("\n");
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

    throw new Error("Unable to extract DOM after multiple attempts.");
}
