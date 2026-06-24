import { Annotation } from "@langchain/langgraph";
import { z } from "zod";

// All supported LLM Providers
export type LLM_PROVIDERS = 'openai' | 'anthropic' | 'google' | 'ollama' | 'lmstudio';


// Definition of the tools that the agent can call
export const webActionSchema = z.object({
    action: z.enum(["click", "fill", "select", "enter", "goto", "wait", "check_network", "send_email", "done"]).describe("The action to execute in the browser. Use 'enter' to press Enter, 'goto' to navigate, 'wait' to pause, 'check_network' to inspect network requests, and 'send_email' to send a report email to an allowed recipient."),
    agentId: z.string().optional().describe("The target element ID (e.g. 'agent-el-12'). Not required for 'done' and 'goto'. For 'enter', it is optional if the element is already focused."),
    value: z.string().optional().describe("The value to input (for 'fill') or select (for 'select')."),
    url: z.string().url().optional().describe("Destination URL to use when action='goto'."),
    seconds: z.number().positive().optional().describe("Number of seconds to wait when action='wait'."),
    to: z.string().email().optional().describe("Recipient email address (must be in the mailing list). Required when action='send_email'."),
    subject: z.string().optional().describe("Email subject. Used when action='send_email'."),
    body: z.string().optional().describe("Email body content. Used when action='send_email'."),
    reasoning: z.string().describe("The logical explanation behind this specific action."),
    taskName: z.string().optional().describe("Il NOME ESATTO del task in checklist che questa azione completa (es. 'Attendere 10 secondi'). Copia la riga dalla checklist senza la checkbox."),
    progress: z.string().optional().describe("Task checklist aggiornata. Formato:\n- [x] task completato\n- [ ] task da fare\nUsa questo campo per tracciare cosa hai fatto e cosa manca.")
}).describe("Executes a guided action on the current web page based on the analyzed AST.");

// --- Types definition ---
// DomainStatus tracks the progress of key actions for a single domain/site.
// In this project, it records whether the following steps have already occurred:
// 1. filled: a field was filled.
// 2. submitted: an input/form was submitted (e.g. Enter/form submit).
// 3. clicked: a relevant click action was performed.
// 4. clickedResult: a useful search/result item was clicked.
// 5. cookieHandled: the cookie banner was handled.
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
    tasks: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
    networkLog: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
});

export type AgentState = typeof AgentStateDef.State;
