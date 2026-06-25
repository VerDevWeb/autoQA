import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const reasoningField = z.string().describe("Logical explanation for this action.");
const taskNameField = z.string().optional().describe("EXACT name of the checklist task that this action completes (e.g. 'Wait 10 seconds'). Copy from checklist without checkbox.");
const progressField = z.string().optional().describe("Updated task checklist. Format:\n- [x] completed task\n- [ ] task to do\nUse to track what you did and what remains.");

const clickSchema = z.object({
    agentId: z.string().describe("ID of the element to click (e.g. 'agent-el-12')."),
    reasoning: reasoningField,
    taskName: taskNameField,
    progress: progressField,
});

export const clickTool = new DynamicStructuredTool({
    name: "click",
    description: "Clicks an interactive element on the page identified by its agentId.",
    schema: clickSchema,
    func: async () => "ok",
});

const fillSchema = z.object({
    agentId: z.string().describe("ID dell'elemento in cui scrivere (es. 'agent-el-12')."),
    value: z.string().describe("Il testo da inserire nel campo."),
    reasoning: reasoningField,
    taskName: taskNameField,
    progress: progressField,
});

export const fillTool = new DynamicStructuredTool({
    name: "fill",
    description: "Scrive un valore in un campo di input/textarea identificato dal suo agentId.",
    schema: fillSchema,
    func: async () => "ok",
});

const fillManySchema = z.object({
    items: z.array(z.object({
        agentId: z.string().describe("ID del campo da compilare (es. 'agent-el-12')."),
        value: z.string().describe("Valore da inserire nel campo specificato."),
    })).min(1).describe("Lista dei campi da compilare in un solo passaggio."),
    reasoning: reasoningField,
    taskName: taskNameField,
    progress: progressField,
});

export const fillManyTool = new DynamicStructuredTool({
    name: "fill_many",
    description: "Compila piu campi input/textarea in un unico colpo. Ideale per form con molti campi.",
    schema: fillManySchema,
    func: async () => "ok",
});

const selectSchema = z.object({
    agentId: z.string().describe("ID dell'elemento select (es. 'agent-el-12')."),
    value: z.string().describe("Il valore/opzione da selezionare."),
    reasoning: reasoningField,
    taskName: taskNameField,
    progress: progressField,
});

export const selectTool = new DynamicStructuredTool({
    name: "select",
    description: "Seleziona un'opzione in un elemento <select> identificato dal suo agentId.",
    schema: selectSchema,
    func: async () => "ok",
});

const enterSchema = z.object({
    agentId: z.string().optional().describe("ID of the element to press Enter on (optional if already focused)."),
    reasoning: reasoningField,
    taskName: taskNameField,
    progress: progressField,
});

export const enterTool = new DynamicStructuredTool({
    name: "enter",
    description: "Simulates pressing the Enter key to submit a form or confirm a search.",
    schema: enterSchema,
    func: async () => "ok",
});

const gotoSchema = z.object({
    url: z.string().url().describe("URL di destinazione completo (https://...)."),
    reasoning: reasoningField,
    taskName: taskNameField,
    progress: progressField,
});

export const gotoTool = new DynamicStructuredTool({
    name: "goto",
    description: "Naviga verso un URL completo (https://...). Usalo quando devi cambiare pagina o andare su un dominio specifico.",
    schema: gotoSchema,
    func: async () => "ok",
});

const waitSchema = z.object({
    seconds: z.number().positive().describe("Number of seconds to wait."),
    reasoning: reasoningField,
    taskName: taskNameField,
    progress: progressField,
});

export const waitTool = new DynamicStructuredTool({
    name: "wait",
    description: "Waits for a given number of seconds. Use it when the objective requires a wait or when you need to wait for dynamic loading.",
    schema: waitSchema,
    func: async () => "ok",
});

const checkNetworkSchema = z.object({
    reasoning: reasoningField,
    taskName: taskNameField,
    progress: progressField,
});

export const checkNetworkTool = new DynamicStructuredTool({
    name: "check_network",
    description: "Mostra le ultime richieste di rete (fetch, XHR) registrate. Usalo per verificare se un'operazione API ha funzionato o dato errore.",
    schema: checkNetworkSchema,
    func: async () => "ok",
});

const checkConsoleSchema = z.object({
    reasoning: reasoningField,
    taskName: taskNameField,
    progress: progressField,
});

const checkUiMessagesSchema = z.object({
    reasoning: reasoningField,
    taskName: taskNameField,
    progress: progressField,
});

export const checkConsoleTool = new DynamicStructuredTool({
    name: "check_console",
    description: "Mostra i messaggi recenti della console browser (log, warning, error). Usalo per diagnosticare problemi frontend/script.",
    schema: checkConsoleSchema,
    func: async () => "ok",
});

export const checkUiMessagesTool = new DynamicStructuredTool({
    name: "check_ui_messages",
    description: "Mostra messaggi UI transient (toast, snackbar, alert, status) anche se sono apparsi e spariti velocemente.",
    schema: checkUiMessagesSchema,
    func: async () => "ok",
});


export const browserTools = [
    clickTool,
    fillTool,
    fillManyTool,
    selectTool,
    enterTool,
    gotoTool,
    waitTool,
    checkNetworkTool,
    checkConsoleTool,
    checkUiMessagesTool,
];
