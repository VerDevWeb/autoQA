import { Annotation } from "@langchain/langgraph";
import { z } from "zod";

export type LLM_TYPES = 'openai' | 'anthropic' | 'google' | 'ollama' | 'lmstudio';

// --- DEFINIZIONI SCHEMA ZOD ---
export const webActionSchema = z.object({
    action: z.enum(["click", "fill", "select", "enter", "goto", "done"]).describe("L'azione da eseguire sul browser. Usa 'enter' per premere Invio e 'goto' per navigare a un URL."),
    agentId: z.string().optional().describe("L'ID dell'elemento target (es. 'agent-el-12'). Non serve per 'done' e 'goto'. Per 'enter' e' opzionale se l'elemento e' gia' in focus."),
    value: z.string().optional().describe("Il valore da inserire (per 'fill') o da selezionare (per 'select')."),
    url: z.string().url().optional().describe("URL di destinazione da usare quando action='goto'."),
    reasoning: z.string().describe("La spiegazione logica dietro a questa specifica azione.")
}).describe("Esegue un'azione guidata sulla pagina web corrente sulla base dell'AST analizzato.");

// --- DEFINIZIONI TIPI ---
export type DomainStatus = {
    filled: boolean;
    submitted: boolean;
    clicked: boolean;
    clickedResult: boolean;
    cookieHandled: boolean;
};

export type AstElement = {
    agentId: string;
    tagName: string;
    text: string;
    attributes: Record<string, string>;
};

export type WebAction = z.infer<typeof webActionSchema>;

// --- STATO DEL GRAFO ---
export const AgentStateDef = Annotation.Root({
    objective: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
    currentUrl: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
    domAst: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
    lastToolCall: Annotation<any>({ reducer: (x, y) => y ?? x, default: () => null }),
    actionHistory: Annotation<string[]>({ reducer: (x, y) => y ?? x, default: () => [] }),
    completedDomains: Annotation<string[]>({ reducer: (x, y) => y ?? x, default: () => [] }),
    domainStatus: Annotation<Record<string, DomainStatus>>({ reducer: (x, y) => y ?? x, default: () => ({}) }),
    noToolCallStreak: Annotation<number>({ reducer: (x, y) => y ?? x, default: () => 0 }),
    isFinished: Annotation<boolean>({ reducer: (x, y) => y ?? x, default: () => false }),
});

export type AgentState = typeof AgentStateDef.State;
