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
            const elements: { agentId: string; tagName: string; text: string; attributes: Record<string, string>; label: string }[] = [];
            const selector = 'a, button, input, select, textarea, details, summary, label, dialog, [role="button"], [role="listbox"], [role="option"], [role="menuitem"], [role="combobox"], [role="tab"], [role="link"], [onclick], [cursor="pointer"], [contenteditable], [tabindex]:not([tabindex="-1"])';
            const interactables = document.querySelectorAll(selector);

            const bodyText = document.body?.innerText || "";
            const bodyWords = bodyText.trim() ? bodyText.trim().split(/\s+/).length : 0;
            const compactMode = bodyWords > 1200;
            const maxWordsPerElement = 20;

            interactables.forEach((el: Element) => {
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) return;
                const style = window.getComputedStyle(el);
                if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return;

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

                elements.push({
                    agentId: id,
                    tagName: el.tagName.toLowerCase(),
                    text: visualText,
                    attributes: attributes,
                    label: label
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

function serializeAttr(attr: Record<string, string>): string {
    const pairs: string[] = [];
    for (const [k, v] of Object.entries(attr)) {
        if (!v) continue;
        const kc = k.toLowerCase();
        // only keep semantically useful attributes
        if (
            kc === "id" ||
            kc === "class" ||
            kc === "type" ||
            kc === "name" ||
            kc === "role" ||
            kc === "placeholder" ||
            kc === "href" ||
            kc === "src" ||
            kc === "aria-label" ||
            kc === "value" ||
            kc === "tabindex" ||
            kc.startsWith("data-") ||
            kc.startsWith("aria-")
        ) {
            pairs.push(kc, `"${escapeSExpr(v.slice(0, 120))}"`);
        }
    }
    if (pairs.length === 0) return "";
    return ` (@ ${pairs.join(" ")})`;
}

export function buildCompactAstForPrompt(domAst: string): string {
    const elements = parseDomAst(domAst);
    if (elements.length === 0) {
        return "";
    }

    return elements.map((el) => {
        const tag = el.tagName || "div";
        const txt = escapeSExpr(el.text || "").slice(0, 200);
        const attrBlock = serializeAttr(el.attributes || {});
        const label = el.label ? escapeSExpr(el.label).slice(0, 120) : "";

        const extras: string[] = [];
        if (label) extras.push(`l="${label}"`);
        const extrasBlock = extras.length > 0 ? ` ${extras.join(" ")}` : "";

        if (txt) {
            return `(${tag}${attrBlock}${extrasBlock} "${txt}")`;
        }
        return `(${tag}${attrBlock}${extrasBlock})`;
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

    throw new Error("Unable to extract DOM after multiple attempts.");
}
