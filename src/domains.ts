import type { DomainStatus, AstElement } from "./types.js";

// --- DOMAIN MANAGEMENT FUNCTIONS ---

// Strips "www." prefix and lowercases the domain
export function normalizeDomain(domain: string): string {
    return domain.toLowerCase().replace(/^www\./, "").trim();
}

// Extracts the domain from a full URL (e.g. "https://www.google.com/hello" -> "google.com")
export function getDomainFromUrl(urlValue: string): string {
    try {
        return normalizeDomain(new URL(urlValue).hostname);
    } catch {
        return "";
    }
}

// Checks if two domains are the same (e.g. "www.google.com" and "google.com" match)
export function domainsMatch(left: string, right: string): boolean {
    const l = normalizeDomain(left);
    const r = normalizeDomain(right);
    return l === r || l.endsWith(`.${r}`) || r.endsWith(`.${l}`);
}

// Parses the objective (e.g. "go to wikipedia.org then youtube.com") and extracts domains in order of appearance
export function extractObjectiveDomains(objective: string): string[] {
    const text = objective.toLowerCase();
    const matches: string[] = [];

    // Prefer hosts extracted from explicit URLs (supports localhost and IPs).
    const urlRegex = /https?:\/\/[^\s"'<>]+/g;
    let u: RegExpExecArray | null;
    while ((u = urlRegex.exec(text)) !== null) {
        const host = getDomainFromUrl(u[0]);
        if (host) {
            matches.push(host);
        }
    }

    const regex = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
        const candidate = m[0];
        if (!candidate) continue;

        // Skip segments that are part of an email address (e.g. user@example.com).
        const charBefore = m.index > 0 ? text[m.index - 1] : "";
        const charAfter = text[m.index + candidate.length] || "";
        if (charBefore === "@" || charAfter === "@") {
            continue;
        }

        matches.push(candidate);
    }

    const orderedUnique: string[] = [];
    for (const match of matches) {
        const normalized = normalizeDomain(match);
        if (!orderedUnique.some((d) => domainsMatch(d, normalized))) {
            orderedUnique.push(normalized);
        }
    }
    return orderedUnique;
}

// Returns the next domain to visit (first in the list that hasn't been completed yet)
export function findNextTargetDomain(objectiveDomains: string[], completedDomains: string[]): string | null {
    for (const objectiveDomain of objectiveDomains) {
        const isAlreadyCompleted = completedDomains.some((completed) => domainsMatch(completed, objectiveDomain));
        if (!isAlreadyCompleted) {
            return objectiveDomain;
        }
    }
    return null;
}

// --- COMPLETION TRACKING FUNCTIONS ---

// Determines whether a domain's tasks are done based on recorded actions on that domain
// Wikipedia just needs submission (searched); YouTube also needs a video click; others just need submit or generic click
export function isDomainComplete(domain: string, status: DomainStatus | undefined, objective: string): boolean {
    if (!status) return false;
    const objectiveLc = objective.toLowerCase();
    const isYoutube = domain.includes("youtube.");
    const wantsClickResult = objectiveLc.includes("click") && objectiveLc.includes("result");

    if (isYoutube && wantsClickResult) {
        return status.submitted && status.clickedResult;
    }

    if (domain.includes("wikipedia.")) {
        return status.submitted;
    }

    return status.submitted || status.clicked;
}

// Checks if a clicked element is a cookie consent banner (based on text and aria-label: "cookie", "accept", "consent", etc.)
export function isConsentLikeElement(target: AstElement | undefined): boolean {
    if (!target) return false;
    const text = (target.text || "").toLowerCase();
    const aria = (target.attributes?.["aria-label"] || "").toLowerCase();
    const combined = `${text} ${aria}`;
    return combined.includes("cookie")
        || combined.includes("consent")
        || combined.includes("accept")
        || combined.includes("accept all")
        || combined.includes("consent");
}

// Checks if a clicked element is a YouTube video result (/watch link, video-title class, etc.)
export function isYoutubeResultLikeElement(target: AstElement | undefined): boolean {
    if (!target) return false;
    const href = (target.attributes?.href || "").toLowerCase();
    const id = (target.attributes?.id || "").toLowerCase();
    const className = (target.attributes?.class || "").toLowerCase();
    const tag = (target.tagName || "").toLowerCase();

    if (href.includes("/watch") || href.includes("watch?v=")) return true;
    if (id.includes("video-title")) return true;
    if (className.includes("ytd-video-renderer") || className.includes("video-title")) return true;
    if (tag === "a" && target.text.trim().length > 0) return true;

    return false;
}

// Updates domain status: creates entry if missing (defaults to all false), then applies the updater (e.g. "set clicked = true")
export function upsertDomainStatus(
    current: Record<string, DomainStatus>,
    domain: string,
    updater: (prev: DomainStatus) => DomainStatus
): Record<string, DomainStatus> {
    if (!domain) return current;
    const base: DomainStatus = current[domain] ?? {
        filled: false,
        submitted: false,
        clicked: false,
        clickedResult: false,
        cookieHandled: false
    };
    return {
        ...current,
        [domain]: updater(base)
    };
}

// If the domain is complete (see isDomainComplete) and not already in the list, adds it to completed domains
export function tryMarkCompletedDomain(
    objective: string,
    domain: string,
    domainStatus: Record<string, DomainStatus>,
    completedDomains: string[]
): string[] {
    if (!domain) return completedDomains;
    if (!isDomainComplete(domain, domainStatus[domain], objective)) {
        return completedDomains;
    }
    if (completedDomains.some((d) => domainsMatch(d, domain))) {
        return completedDomains;
    }
    return [...completedDomains, domain];
}
