import { Annotation } from "@langchain/langgraph";

// All supported LLM Providers
export type LLM_PROVIDERS = 'openai' | 'anthropic' | 'google' | 'ollama' | 'lmstudio';

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
