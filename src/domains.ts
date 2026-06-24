import type { DomainStatus, AstElement } from "./types.js";

// --- FUNZIONI PER GESTIONE DOMINI ---

// Pulisce il nome del dominio: toglie "www." e mette in minuscolo
export function normalizeDomain(domain: string): string {
    return domain.toLowerCase().replace(/^www\./, "").trim();
}

// Da un URL completo (es. "https://www.google.com/ciao") estrae solo il dominio (es. "google.com")
export function getDomainFromUrl(urlValue: string): string {
    try {
        return normalizeDomain(new URL(urlValue).hostname);
    } catch {
        return "";
    }
}

// Controlla se due domini sono lo stesso (es. "www.google.com" e "google.com" matchano)
export function domainsMatch(left: string, right: string): boolean {
    const l = normalizeDomain(left);
    const r = normalizeDomain(right);
    return l === r || l.endsWith(`.${r}`) || r.endsWith(`.${l}`);
}

// Legge l'obiettivo (es. "vai su wikipedia.org e poi su youtube.com") e ne estrae i domini in ordine di apparizione
export function extractObjectiveDomains(objective: string): string[] {
    const matches = objective.toLowerCase().match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/g) ?? [];
    const orderedUnique: string[] = [];
    for (const match of matches) {
        const normalized = normalizeDomain(match);
        if (!orderedUnique.some((d) => domainsMatch(d, normalized))) {
            orderedUnique.push(normalized);
        }
    }
    return orderedUnique;
}

// Dà il prossimo dominio da visitare (il primo nella lista che non è ancora stato completato)
export function findNextTargetDomain(objectiveDomains: string[], completedDomains: string[]): string | null {
    for (const objectiveDomain of objectiveDomains) {
        const isAlreadyCompleted = completedDomains.some((completed) => domainsMatch(completed, objectiveDomain));
        if (!isAlreadyCompleted) {
            return objectiveDomain;
        }
    }
    return null;
}

// --- FUNZIONI PER TRACKING COMPLETAMENTO ---

// Dice se un dominio ha finito le cose da fare, in base alle azioni registrate su quel dominio
// Wikipedia basta che abbia fatto submit (cercato); YouTube vuole anche un click su un video; gli altri bastano submit o click generico
export function isDomainComplete(domain: string, status: DomainStatus | undefined, objective: string): boolean {
    if (!status) return false;
    const objectiveLc = objective.toLowerCase();
    const isYoutube = domain.includes("youtube.");
    const wantsClickResult = objectiveLc.includes("clicca") && objectiveLc.includes("risultat");

    if (isYoutube && wantsClickResult) {
        return status.submitted && status.clickedResult;
    }

    if (domain.includes("wikipedia.")) {
        return status.submitted;
    }

    return status.submitted || status.clicked;
}

// Controlla se l'elemento cliccato è un banner cookie (dai testo e aria-label: "cookie", "accetta", "consent", ecc.)
export function isConsentLikeElement(target: AstElement | undefined): boolean {
    if (!target) return false;
    const text = (target.text || "").toLowerCase();
    const aria = (target.attributes?.["aria-label"] || "").toLowerCase();
    const combined = `${text} ${aria}`;
    return combined.includes("cookie")
        || combined.includes("consenso")
        || combined.includes("accetta")
        || combined.includes("accept all")
        || combined.includes("consent");
}

// Controlla se l'elemento cliccato è un risultato video di YouTube (link /watch, classe video-title, ecc.)
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

// Aggiorna lo stato di un dominio: se non esiste ancora, parte tutto su false, poi applica la modifica (es. "metti clicked = true")
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

// Se il dominio ha completato tutto (vedi isDomainComplete) e non è già nella lista, lo aggiunge ai completati
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
