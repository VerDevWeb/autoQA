import type { Page, Locator } from "playwright";

let currentPage: Page;

export function setPageInstance(page: Page): void {
    currentPage = page;
}

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
}
