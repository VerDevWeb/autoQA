import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const reasoningField = z.string().describe("Logical explanation for this action.");
const taskNameField = z.string().optional().describe("EXACT name of the checklist task that this action completes (e.g. 'Wait 10 seconds'). Copy from checklist without checkbox.");
const progressField = z.string().optional().describe("Updated task checklist. Format:\n- [x] completed task\n- [ ] task to do\nUse to track what you did and what remains.");

const sendEmailSchema = z.object({
    to: z.string().email().describe("Recipient email (must be in the mailing list)."),
    subject: z.string().optional().describe("Email subject."),
    body: z.string().optional().describe("Email body."),
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
    description: "Sends a report email to a mailing list recipient. Use it to report what you did.",
    schema: sendEmailSchema,
    func: async () => "ok",
});

export const doneTool = new DynamicStructuredTool({
    name: "done",
    description: "Call this tool when you HAVE COMPLETED ALL the objective tasks. Do not call it before you are done.",
    schema: doneSchema,
    func: async () => "ok",
});

export const generalTools = [
    sendEmailTool,
    doneTool,
];
