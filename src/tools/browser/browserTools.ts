import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const reasoningField = z.string().describe("Logical explanation for this action.");
const taskNameField = z.string().optional().describe("EXACT name of the checklist task that this action completes (e.g. 'Wait 10 seconds'). Copy from checklist without checkbox.");
const progressField = z.string().optional().describe("Updated task checklist. Format:\n- [x] completed task\n- [ ] task to do\nUse to track what you did and what remains.");

const targetField = z.object({
    css: z.string().optional().describe("Optional CSS selector when stable and specific."),
    tag: z.string().optional().describe("Element tag (input, button, select, a, textarea, ...)."),
    id: z.string().optional().describe("HTML id attribute without #."),
    name: z.string().optional().describe("HTML name attribute."),
    type: z.string().optional().describe("HTML input type when relevant."),
    placeholder: z.string().optional().describe("Placeholder text when present."),
    ariaLabel: z.string().optional().describe("aria-label value when present."),
    role: z.string().optional().describe("ARIA role when present."),
    href: z.string().optional().describe("Href fragment for links."),
    text: z.string().optional().describe("Visible text associated to the element."),
    label: z.string().optional().describe("Associated label text for form controls.")
}).describe("Target element using real HTML attributes visible in the DOM tree.");

const clickSchema = z.object({
    target: targetField.optional(),
    agentId: z.string().optional().describe("Deprecated: legacy synthetic id."),
    reasoning: reasoningField,
    taskName: taskNameField,
    progress: progressField,
}).refine((data) => Boolean(data.target || data.agentId), {
    message: "Provide target (preferred) or legacy agentId."
});

export const clickTool = new DynamicStructuredTool({
    name: "click",
    description: "Clicks an interactive element identified by real HTML attributes.",
    schema: clickSchema,
    func: async () => "ok",
});

const fillSchema = z.object({
    target: targetField.optional(),
    agentId: z.string().optional().describe("Deprecated: legacy synthetic id."),
    value: z.string().describe("Text to type into the field."),
    reasoning: reasoningField,
    taskName: taskNameField,
    progress: progressField,
}).refine((data) => Boolean(data.target || data.agentId), {
    message: "Provide target (preferred) or legacy agentId."
});

export const fillTool = new DynamicStructuredTool({
    name: "fill",
    description: "Types a value into an input/textarea identified by real HTML attributes.",
    schema: fillSchema,
    func: async () => "ok",
});

const uploadFileSchema = z.object({
    target: targetField.optional(),
    agentId: z.string().optional().describe("Deprecated: legacy synthetic id."),
    filePath: z.string().describe("Path of the file to upload. It can be project-root relative or absolute."),
    reasoning: reasoningField,
    taskName: taskNameField,
    progress: progressField,
}).refine((data) => Boolean(data.target || data.agentId), {
    message: "Provide target (preferred) or legacy agentId."
});

export const uploadFileTool = new DynamicStructuredTool({
    name: "upload_file",
    description: "Attaches a file to an HTML file input (<input type='file'>) identified by real HTML attributes.",
    schema: uploadFileSchema,
    func: async () => "ok",
});

const fillManySchema = z.object({
    items: z.array(z.object({
        target: targetField.optional(),
        agentId: z.string().optional().describe("Deprecated: legacy synthetic id."),
        value: z.string().describe("Value to type into the specified field."),
    }).refine((data) => Boolean(data.target || data.agentId), {
        message: "Provide target (preferred) or legacy agentId."
    })).min(1).describe("List of fields to fill in a single step."),
    reasoning: reasoningField,
    taskName: taskNameField,
    progress: progressField,
});

export const fillManyTool = new DynamicStructuredTool({
    name: "fill_many",
    description: "Fills multiple input/textarea fields in one shot. Ideal for large forms.",
    schema: fillManySchema,
    func: async () => "ok",
});

const selectSchema = z.object({
    target: targetField.optional(),
    agentId: z.string().optional().describe("Deprecated: legacy synthetic id."),
    value: z.string().describe("Option value to select."),
    reasoning: reasoningField,
    taskName: taskNameField,
    progress: progressField,
}).refine((data) => Boolean(data.target || data.agentId), {
    message: "Provide target (preferred) or legacy agentId."
});

export const selectTool = new DynamicStructuredTool({
    name: "select",
    description: "Selects an option in a <select> element identified by real HTML attributes.",
    schema: selectSchema,
    func: async () => "ok",
});

const enterSchema = z.object({
    target: targetField.optional(),
    agentId: z.string().optional().describe("Deprecated: legacy synthetic id."),
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
    url: z.string().url().describe("Full destination URL (https://...)."),
    reasoning: reasoningField,
    taskName: taskNameField,
    progress: progressField,
});

export const gotoTool = new DynamicStructuredTool({
    name: "goto",
    description: "Navigates to a full URL (https://...). Use it when you need to change page or move to a specific domain.",
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
    description: "Shows the most recent captured network requests (fetch, XHR). Use it to verify whether an API operation succeeded or failed.",
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
    description: "Shows recent browser console messages (log, warning, error). Use it to diagnose frontend/script issues.",
    schema: checkConsoleSchema,
    func: async () => "ok",
});

export const checkUiMessagesTool = new DynamicStructuredTool({
    name: "check_ui_messages",
    description: "Shows transient UI messages (toast, snackbar, alert, status), even if they appeared and disappeared quickly.",
    schema: checkUiMessagesSchema,
    func: async () => "ok",
});


export const browserTools = [
    clickTool,
    fillTool,
    uploadFileTool,
    fillManyTool,
    selectTool,
    enterTool,
    gotoTool,
    waitTool,
    checkNetworkTool,
    checkConsoleTool,
    checkUiMessagesTool,
];
