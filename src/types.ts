import { Annotation } from "@langchain/langgraph";
import { z } from "zod";

export type LLM_TYPES = 'openai' | 'anthropic' | 'google' | 'ollama' | 'lmstudio';

<<<<<<< HEAD
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

=======
// --- DEFINIZIONI SCHEMA ZOD ---
export const webActionSchema = z.object({
    action: z.enum(["click", "fill", "select", "enter", "goto", "done"]).describe("L'azione da eseguire sul browser. Usa 'enter' per premere Invio e 'goto' per navigare a un URL."),
    agentId: z.string().optional().describe("L'ID dell'elemento target (es. 'agent-el-12'). Non serve per 'done' e 'goto'. Per 'enter' e' opzionale se l'elemento e' gia' in focus."),
    value: z.string().optional().describe("Il valore da inserire (per 'fill') o da selezionare (per 'select')."),
    url: z.string().url().optional().describe("URL di destinazione da usare quando action='goto'."),
    reasoning: z.string().describe("La spiegazione logica dietro a questa specifica azione.")
}).describe("Esegue un'azione guidata sulla pagina web corrente sulla base dell'AST analizzato.");

// --- DEFINIZIONI TIPI ---
>>>>>>> 9afb263 (code refactor => divided index.ts into single files, each file's function or content is explained in the README.ts)
export type DomainStatus = {
    filled: boolean;
    submitted: boolean;
    clicked: boolean;
    clickedResult: boolean;
    cookieHandled: boolean;
};

export type AstElement = {
<<<<<<< HEAD
=======
    agentId: string;
>>>>>>> 9afb263 (code refactor => divided index.ts into single files, each file's function or content is explained in the README.ts)
    tagName: string;
    text: string;
    attributes: Record<string, string>;
};

export type WebAction = z.infer<typeof webActionSchema>;

<<<<<<< HEAD
=======
// --- STATO DEL GRAFO ---
>>>>>>> 9afb263 (code refactor => divided index.ts into single files, each file's function or content is explained in the README.ts)
export const AgentStateDef = Annotation.Root({
    objective: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
    currentUrl: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
    domAst: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
<<<<<<< HEAD
    domElements: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "[]" }),
=======
>>>>>>> 9afb263 (code refactor => divided index.ts into single files, each file's function or content is explained in the README.ts)
    lastToolCall: Annotation<any>({ reducer: (x, y) => y ?? x, default: () => null }),
    actionHistory: Annotation<string[]>({ reducer: (x, y) => y ?? x, default: () => [] }),
    completedDomains: Annotation<string[]>({ reducer: (x, y) => y ?? x, default: () => [] }),
    domainStatus: Annotation<Record<string, DomainStatus>>({ reducer: (x, y) => y ?? x, default: () => ({}) }),
    noToolCallStreak: Annotation<number>({ reducer: (x, y) => y ?? x, default: () => 0 }),
    isFinished: Annotation<boolean>({ reducer: (x, y) => y ?? x, default: () => false }),
<<<<<<< HEAD
    progress: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
=======
>>>>>>> 9afb263 (code refactor => divided index.ts into single files, each file's function or content is explained in the README.ts)
});

export type AgentState = typeof AgentStateDef.State;
