import http, { type IncomingMessage, type ServerResponse } from "node:http";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import "./env.js";

import { runAgent } from "./index.js";

type Provider = "github" | "gitlab" | "gitlab-onprem";

type QueuedRun = {
    provider: Provider;
    repository: string;
    commitId: string;
    objective: string;
    sourceMessage: string;
};

type GitHubPushPayload = {
    repository?: { full_name?: string };
    commits?: Array<{ id?: string; message?: string }>;
};

type GitLabPushPayload = {
    project?: { path_with_namespace?: string; web_url?: string };
    commits?: Array<{ id?: string; message?: string }>;
};

const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT || "8787");
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";
const GITLAB_WEBHOOK_TOKEN = process.env.GITLAB_WEBHOOK_TOKEN || "";
const GITLAB_ONPREM_WEBHOOK_TOKEN = process.env.GITLAB_ONPREM_WEBHOOK_TOKEN || GITLAB_WEBHOOK_TOKEN;
const GITLAB_ONPREM_BASE_URL = process.env.GITLAB_ONPREM_BASE_URL || "";
const AUTOQA_COMMAND_PATTERN = /autoqa\s*:\s*([\s\S]+)/i;

let runChain: Promise<void> = Promise.resolve();

function isDirectRun(): boolean {
    const entryPath = process.argv[1];
    if (!entryPath) return false;
    return import.meta.url === pathToFileURL(entryPath).href;
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];

    for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }

    return Buffer.concat(chunks);
}

function safeJsonParse<T>(buffer: Buffer): T | null {
    try {
        return JSON.parse(buffer.toString("utf8")) as T;
    } catch {
        return null;
    }
}

function timingSafeEqualString(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);

    if (left.length !== right.length) {
        return false;
    }

    return crypto.timingSafeEqual(left, right);
}

function verifyGitHubSignature(rawBody: Buffer, headerValue: string | undefined): boolean {
    if (!GITHUB_WEBHOOK_SECRET) {
        console.error("[webhook][github] Missing GITHUB_WEBHOOK_SECRET.");
        return false;
    }

    if (!headerValue || !headerValue.startsWith("sha256=")) {
        return false;
    }

    const expected = `sha256=${crypto
        .createHmac("sha256", GITHUB_WEBHOOK_SECRET)
        .update(rawBody)
        .digest("hex")}`;

    return timingSafeEqualString(expected, headerValue);
}

function verifyGitLabToken(tokenHeader: string | undefined, provider: Provider): boolean {
    const tokenToUse = provider === "gitlab-onprem" ? GITLAB_ONPREM_WEBHOOK_TOKEN : GITLAB_WEBHOOK_TOKEN;

    if (!tokenToUse) {
        console.error(`[webhook][${provider}] Missing webhook token env var.`);
        return false;
    }

    if (!tokenHeader) {
        return false;
    }

    return timingSafeEqualString(tokenToUse, tokenHeader);
}

function extractObjectivesFromMessage(message: string): string[] {
    const normalized = message.trim();
    if (!normalized) return [];

    const match = normalized.match(AUTOQA_COMMAND_PATTERN);
    if (!match || !match[1]) return [];

    return [match[1].trim()].filter(Boolean);
}

function enqueueRun(run: QueuedRun): void {
    runChain = runChain
        .then(async () => {
            console.log(`[webhook][runner] Starting objective from ${run.provider} ${run.repository}@${run.commitId}`);
            await runAgent(run.objective);
            console.log(`[webhook][runner] Completed objective from ${run.provider} ${run.repository}@${run.commitId}`);
        })
        .catch((error) => {
            console.error("[webhook][runner] Run failed:", error);
        });
}

function collectGitHubRuns(payload: GitHubPushPayload): QueuedRun[] {
    const repository = payload.repository?.full_name || "unknown-repo";
    const commits = payload.commits || [];
    const runs: QueuedRun[] = [];

    for (const commit of commits) {
        const commitId = commit.id || "unknown-commit";
        const message = commit.message || "";

        for (const objective of extractObjectivesFromMessage(message)) {
            runs.push({
                provider: "github",
                repository,
                commitId,
                objective,
                sourceMessage: message,
            });
        }
    }

    return runs;
}

function collectGitLabRuns(payload: GitLabPushPayload, provider: Provider): QueuedRun[] {
    const repository = payload.project?.path_with_namespace || "unknown-repo";
    const commits = payload.commits || [];
    const runs: QueuedRun[] = [];

    if (provider === "gitlab-onprem" && GITLAB_ONPREM_BASE_URL) {
        const projectUrl = payload.project?.web_url || "";
        if (!projectUrl.startsWith(GITLAB_ONPREM_BASE_URL)) {
            console.warn(`[webhook][gitlab-onprem] Project URL not allowed: ${projectUrl}`);
            return [];
        }
    }

    for (const commit of commits) {
        const commitId = commit.id || "unknown-commit";
        const message = commit.message || "";

        for (const objective of extractObjectivesFromMessage(message)) {
            runs.push({
                provider,
                repository,
                commitId,
                objective,
                sourceMessage: message,
            });
        }
    }

    return runs;
}

function sendJson(res: ServerResponse, statusCode: number, payload: Record<string, unknown>) {
    res.statusCode = statusCode;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
}

async function handleGitHubPush(req: IncomingMessage, res: ServerResponse) {
    const event = req.headers["x-github-event"];
    if (event !== "push") {
        return sendJson(res, 202, { ok: true, ignored: true, reason: "event is not push" });
    }

    const rawBody = await readRawBody(req);
    const signature = req.headers["x-hub-signature-256"];
    const signatureValue = Array.isArray(signature) ? signature[0] : signature;

    if (!verifyGitHubSignature(rawBody, signatureValue)) {
        return sendJson(res, 401, { ok: false, error: "invalid signature" });
    }

    const payload = safeJsonParse<GitHubPushPayload>(rawBody);
    if (!payload) {
        return sendJson(res, 400, { ok: false, error: "invalid JSON body" });
    }

    const runs = collectGitHubRuns(payload);
    runs.forEach(enqueueRun);

    return sendJson(res, 202, {
        ok: true,
        queued: runs.length,
        provider: "github",
        details: runs.map((run) => ({ repository: run.repository, commitId: run.commitId, objective: run.objective, sourceMessage: run.sourceMessage })),
    });
}

async function handleGitLabPush(req: IncomingMessage, res: ServerResponse, provider: Provider) {
    const eventHeader = req.headers["x-gitlab-event"];
    const eventName = Array.isArray(eventHeader) ? eventHeader[0] : eventHeader;

    if (!eventName || !eventName.toLowerCase().includes("push")) {
        return sendJson(res, 202, { ok: true, ignored: true, reason: "event is not push" });
    }

    const tokenHeader = req.headers["x-gitlab-token"];
    const tokenValue = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;

    if (!verifyGitLabToken(tokenValue, provider)) {
        return sendJson(res, 401, { ok: false, error: "invalid token" });
    }

    const rawBody = await readRawBody(req);
    const payload = safeJsonParse<GitLabPushPayload>(rawBody);
    if (!payload) {
        return sendJson(res, 400, { ok: false, error: "invalid JSON body" });
    }

    const runs = collectGitLabRuns(payload, provider);
    runs.forEach(enqueueRun);

    return sendJson(res, 202, {
        ok: true,
        queued: runs.length,
        provider,
        details: runs.map((run) => ({ repository: run.repository, commitId: run.commitId, objective: run.objective, sourceMessage: run.sourceMessage })),
    });
}

export function startGitWebhookServer(port = WEBHOOK_PORT) {
    const server = http.createServer(async (req, res) => {
        if (!req.url || req.method !== "POST") {
            return sendJson(res, 404, { ok: false, error: "not found" });
        }

        try {
            if (req.url === "/webhooks/github") {
                return await handleGitHubPush(req, res);
            }

            if (req.url === "/webhooks/gitlab") {
                return await handleGitLabPush(req, res, "gitlab");
            }

            if (req.url === "/webhooks/gitlab/onprem") {
                return await handleGitLabPush(req, res, "gitlab-onprem");
            }

            return sendJson(res, 404, { ok: false, error: "not found" });
        } catch (error) {
            console.error("[webhook] Internal server error", error);
            return sendJson(res, 500, { ok: false, error: "internal server error" });
        }
    });

    server.listen(port, () => {
        console.log(`[webhook] Listening on port ${port}`);
        console.log("[webhook] Endpoints: /webhooks/github, /webhooks/gitlab, /webhooks/gitlab/onprem");
    });

    return server;
}

if (isDirectRun()) {
    startGitWebhookServer();
}
