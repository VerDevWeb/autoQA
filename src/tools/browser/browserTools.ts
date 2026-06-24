import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const reasoningField = z.string().describe("Spiegazione logica di questa azione.");
const taskNameField = z.string().optional().describe("Nome ESATTO del task in checklist che questa azione completa (es. 'Attendere 10 secondi'). Copia dalla checklist senza checkbox.");
const progressField = z.string().optional().describe("Task checklist aggiornata. Formato:\n- [x] task completato\n- [ ] task da fare\nUsa per tracciare cosa hai fatto e cosa manca.");

const clickSchema = z.object({
    agentId: z.string().describe("ID dell'elemento da cliccare (es. 'agent-el-12')."),
    reasoning: reasoningField,
    taskName: taskNameField,
    progress: progressField,
});

export const clickTool = new DynamicStructuredTool({
    name: "click",
    description: "Clicca su un elemento interattivo della pagina identificato dal suo agentId.",
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
    agentId: z.string().optional().describe("ID dell'elemento su cui premere Invio (opzionale se già focalizzato)."),
    reasoning: reasoningField,
    taskName: taskNameField,
    progress: progressField,
});

export const enterTool = new DynamicStructuredTool({
    name: "enter",
    description: "Simula la pressione del tasto Invio per inviare un form o confermare una ricerca.",
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
    seconds: z.number().positive().describe("Numero di secondi di attesa."),
    reasoning: reasoningField,
    taskName: taskNameField,
    progress: progressField,
});

export const waitTool = new DynamicStructuredTool({
    name: "wait",
    description: "Attende per un dato numero di secondi. Usalo quando l'obiettivo richiede un'attesa o quando devi aspettare caricamenti dinamici.",
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


export const browserTools = [
    clickTool,
    fillTool,
    selectTool,
    enterTool,
    gotoTool,
    waitTool,
    checkNetworkTool,
];
