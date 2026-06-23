import { Annotation } from "@langchain/langgraph";
import { z } from "zod";

export type LLM_TYPES = 'openai' | 'anthropic' | 'google' | 'ollama' | 'lmstudio';

export const webActionSchema = z.object({
    action: z.enum(["click", "fill", "select", "enter", "goto", "done"]).describe("Azione da eseguire sul browser."),
    tag: z.string().optional().describe("Tag HTML dell'elemento target (es. 'a', 'button', 'input')."),
    text: z.string().optional().describe("Il testo visibile dell'elemento target (innerText)."),
    attrs: z.record(z.string(), z.string()).optional().describe("Attributi HTML chiave per identificare l'elemento (es. {\"href\": \"/wiki/Ferrari\"})."),
    value: z.string().optional().describe("Il valore da inserire (per 'fill') o da selezionare (per 'select')."),
    url: z.string().url().optional().describe("URL di destinazione per action='goto'."),
    reasoning: z.string().describe("Spiegazione logica di questa azione."),
    progress: z.string().optional().describe("Checkpoint: COSA HAI APPENA FATTO e COSA MANCA per completare l'obiettivo.")
});

export type DomainStatus = {
    filled: boolean;
    submitted: boolean;
    clicked: boolean;
    clickedResult: boolean;
    cookieHandled: boolean;
};

export type AstElement = {
    tagName: string;
    text: string;
    attributes: Record<string, string>;
};

export type WebAction = z.infer<typeof webActionSchema>;

export const AgentStateDef = Annotation.Root({
    objective: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
    currentUrl: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
    domAst: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
    domElements: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "[]" }),
    lastToolCall: Annotation<any>({ reducer: (x, y) => y ?? x, default: () => null }),
    actionHistory: Annotation<string[]>({ reducer: (x, y) => y ?? x, default: () => [] }),
    completedDomains: Annotation<string[]>({ reducer: (x, y) => y ?? x, default: () => [] }),
    domainStatus: Annotation<Record<string, DomainStatus>>({ reducer: (x, y) => y ?? x, default: () => ({}) }),
    noToolCallStreak: Annotation<number>({ reducer: (x, y) => y ?? x, default: () => 0 }),
    isFinished: Annotation<boolean>({ reducer: (x, y) => y ?? x, default: () => false }),
    progress: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
});

export type AgentState = typeof AgentStateDef.State;
