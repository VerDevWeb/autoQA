import type { Page } from "playwright";
import type { AstElement } from "./types.js";

export function sanitizeCompactText(value: string): string {
    return value.replace(/[\r\n|]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseDomElements(json: string): AstElement[] {
    try {
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed)) return [];
        return parsed as AstElement[];
    } catch {
        return [];
    }
}

export async function extractSimplifiedDOM(page: Page): Promise<{ tree: string; elements: AstElement[] }> {
    const code = `(function() {
const INTERACTIVE_SELECTOR = 'a, button, input, select, textarea, [role="button"], [onclick], [cursor="pointer"]';
var WORTHY_ATTRS = ['id', 'class', 'role', 'href', 'type', 'placeholder', 'name', 'aria-label', 'alt', 'src'];

var isVisible = function(el) {
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return true;
};

var isInteractive = function(el) {
    return el.matches(INTERACTIVE_SELECTOR) && isVisible(el);
};

var getVisualText = function(el) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        return el.value || el.getAttribute('placeholder') || '';
    }
    return el.innerText ? el.innerText.trim() : '';
};

var getAttrs = function(el) {
    var attrs = {};
    for (var i = 0; i < WORTHY_ATTRS.length; i++) {
        var name = WORTHY_ATTRS[i];
        var val = el.getAttribute(name);
        if (val) attrs[name] = val;
    }
    return attrs;
};

var formatAttrs = function(el) {
    var parts = [];
    var id = el.getAttribute('id');
    if (id) parts.push('#' + id.split(/\\s+/)[0]);
    var cls = el.getAttribute('class');
    if (cls) {
        var first = cls.trim().split(/\\s+/)[0];
        if (first) parts.push('.' + first);
    }
    for (var i = 0; i < WORTHY_ATTRS.length; i++) {
        var name = WORTHY_ATTRS[i];
        if (name === 'id' || name === 'class') continue;
        var val = el.getAttribute(name);
        if (val && val.length <= 80) {
            parts.push('[' + name + '=' + val.replace(/[\\[\\]]/g, '') + ']');
        }
    }
    return parts.join('');
};

var hasInteractiveSub = function(el) {
    if (isInteractive(el)) return true;
    var children = Array.from(el.children);
    for (var i = 0; i < children.length; i++) {
        if (hasInteractiveSub(children[i])) return true;
    }
    return false;
};

var isSemanticContainer = function(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'body') return true;
    if (el.id) return true;
    if (el.getAttribute('role')) return true;
    var containers = ['nav', 'header', 'footer', 'main', 'aside', 'section', 'article', 'form', 'ul', 'ol', 'table'];
    for (var i = 0; i < containers.length; i++) {
        if (tag === containers[i]) return true;
    }
    return false;
};

var treeLines = [];
var elementsList = [];

var walk = function(node, depth) {
    if (!hasInteractiveSub(node)) return;

    var tag = node.tagName.toLowerCase();
    var show = isSemanticContainer(node);
    var indent = '  '.repeat(depth);

    if (show) {
        treeLines.push(indent + tag + formatAttrs(node));
    }

    var childDepth = show ? depth + 1 : depth;
    var children = Array.from(node.children);

    for (var i = 0; i < children.length; i++) {
        var child = children[i];
        if (isInteractive(child)) {
            var text = getVisualText(child);
            if (!text) continue;

            var attrs = getAttrs(child);
            var safeText = text.replace(/\\s+/g, ' ').trim().substring(0, 180);

            treeLines.push('  '.repeat(childDepth) + child.tagName.toLowerCase() + formatAttrs(child) + ' ' + safeText);

            elementsList.push({
                tagName: child.tagName.toLowerCase(),
                text: safeText,
                attributes: attrs
            });
        } else {
            walk(child, childDepth);
        }
    }
};

walk(document.body, 0);

return { tree: treeLines.join('\\n'), elements: elementsList };
})();
`;
    return await page.evaluate(code);
}

function isContextDestroyedError(error: unknown): boolean {
    const message = (error as Error)?.message ?? String(error);
    return message.includes("Execution context was destroyed")
        || message.includes("Cannot find context with specified id")
        || message.includes("Most likely the page has been closed");
}

export async function extractSimplifiedDOMWithRetry(page: Page, maxAttempts = 4): Promise<{ tree: string; elements: AstElement[] }> {
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
