import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const reasoningField = z.string().describe("Spiegazione logica di questa azione.");
const taskNameField = z.string().optional().describe("Nome ESATTO del task in checklist che questa azione completa (es. 'Attendere 10 secondi'). Copia dalla checklist senza checkbox.");
const progressField = z.string().optional().describe("Task checklist aggiornata. Formato:\n- [x] task completato\n- [ ] task da fare\nUsa per tracciare cosa hai fatto e cosa manca.");

const sendEmailSchema = z.object({
    to: z.string().email().describe("Email del destinatario (deve essere nella mailing list)."),
    subject: z.string().optional().describe("Oggetto dell'email."),
    body: z.string().optional().describe("Corpo dell'email."),
    reasoning: reasoningField,
    taskName: taskNameField,
    progress: progressField,
});

const doneSchema = z.object({
    reasoning: reasoningField,
    progress: progressField,
});


export const sendEmailTool = new DynamicStructuredTool({
    name: "send_email",
    description: "Invia un'email di report a un destinatario della mailing list. Usalo per comunicare il resoconto di ciò che hai fatto.",
    schema: sendEmailSchema,
    func: async () => "ok",
});

export const doneTool = new DynamicStructuredTool({
    name: "done",
    description: "Chiama questo tool quando HAI COMPLETATO TUTTI i task dell'obiettivo. Non chiamarlo prima di aver finito tutto.",
    schema: doneSchema,
    func: async () => "ok",
});

export const generalTools = [
    sendEmailTool,
    doneTool,
];
