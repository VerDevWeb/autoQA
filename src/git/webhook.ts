import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";
import type { Commit, PushData, WebhookBody } from "./gitTypes.js";


const PORT = parseInt(process.env.WEBHOOK_PORT || "9000", 10);

function log(tag: string, msg: string): void {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [${tag}] ${msg}`);
}

function parseBody(req: IncomingMessage): Promise<{ raw: string; json: any }> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf-8");
            try {
                resolve({ raw, json: JSON.parse(raw) as any });
            } catch {
                reject(new Error("Invalid JSON body"));
            }
        });
        req.on("error", reject);
    });
}

function verifySignature(header: string, rawBody: string, secret: string): boolean {
    if (!header || !secret) return true;
    const algo = header.startsWith("sha256=") ? "sha256" as const : "sha1" as const;
    const sig = header.replace(/^sha(256|1)=/, "");
    const expected = crypto.createHmac(algo, secret).update(rawBody).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function extractPushData(headers: http.IncomingHttpHeaders, body: WebhookBody): PushData {
    const github = headers["x-github-event"];
    const gitlab = headers["x-gitlab-event"];
    const bitbucket = headers["x-event-key"];

    let provider: string;
    let repoUrl: string;
    let ref: string;
    let before: string;
    let after: string;
    let commits: Commit[];
    let pusher: string;

    if (github) {
        provider = "GitHub";
        repoUrl = body.repository?.clone_url || body.repository?.git_url || body.repository?.ssh_url || "";
        ref = body.ref || "";
        before = body.before || "";
        after = body.after || "";
        commits = body.commits || [];
        pusher = body.pusher?.name || body.sender?.login || "unknown";
    } else if (gitlab) {
        provider = "GitLab";
        repoUrl = body.project?.git_http_url || body.project?.git_ssh_url || body.project?.url || "";
        ref = body.ref || "";
        before = body.before || "";
        after = body.after || "";
        commits = body.commits || [];
        pusher = body.user_username || body.user_name || "unknown";
    } else if (bitbucket) {
        provider = "BitBucket";
        repoUrl = body.repository?.links?.html?.href || "";
        ref = body.push?.changes?.[0]?.new?.name
            ? `refs/heads/${body.push.changes[0].new.name}`
            : "";
        before = body.push?.changes?.[0]?.old?.target?.hash || "";
        after = body.push?.changes?.[0]?.new?.target?.hash || "";
        const rawCommits = body.push?.changes?.[0]?.commits || [];
        commits = rawCommits.map((c) => {
            const changes = body.push?.changes?.[0]?.changes?.find(
                (ch) => ch.new?.hash === c.hash || ch.old?.hash === c.hash
            );
            return {
                id: c.hash || "",
                message: c.message || "",
                added: changes?.added || [],
                modified: changes?.modified || [],
                removed: changes?.removed || [],
            };
        });
        pusher = body.actor?.nickname || body.actor?.username || "unknown";
    } else {
        provider = "Generic";
        repoUrl = body.repository?.url || body.repository?.git_url || "";
        ref = body.ref || "";
        commits = body.commits || [];
        pusher = body.pusher?.name || "unknown";
        before = "";
        after = "";
    }

    const allAdded: string[] = [];
    const allModified: string[] = [];
    const allRemoved: string[] = [];
    const allFiles = new Set<string>();

    for (const c of commits) {
        (c.added || []).forEach((f: string) => { allFiles.add(f); allAdded.push(f); });
        (c.modified || []).forEach((f: string) => { allFiles.add(f); allModified.push(f); });
        (c.removed || []).forEach((f: string) => { allFiles.add(f); allRemoved.push(f); });
    }

    const branch = ref.replace(/^refs\/heads\//, "");

    return { provider, repoUrl, branch, ref, before, after, commits, pusher, allFiles: [...allFiles], allAdded, allModified, allRemoved };
}

async function handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: { raw: string; json: WebhookBody };
    try {
        body = await parseBody(req);
    } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        log("WEBHOOK", `Body non valido: ${msg}`);
        res.writeHead(400);
        res.end("Invalid body");
        return;
    }

    const secret = process.env.WEBHOOK_SECRET || "";
    const ghSig = (req.headers["x-hub-signature-256"] || req.headers["x-hub-signature"] || "") as string;
    const glToken = (req.headers["x-gitlab-token"] || "") as string;
    if (secret) {
        if (ghSig && !verifySignature(ghSig, body.raw, secret)) {
            log("WEBHOOK", "Firma GitHub non valida");
            res.writeHead(403);
            res.end("Signature mismatch");
            return;
        }
        if (glToken && glToken !== secret) {
            log("WEBHOOK", "Token GitLab non valido");
            res.writeHead(403);
            res.end("Invalid token");
            return;
        }
    }

    const ghEvent = req.headers["x-github-event"] as string | undefined;
    const glEvent = req.headers["x-gitlab-event"] as string | undefined;
    const bbEvent = req.headers["x-event-key"] as string | undefined;

    if (ghEvent && ghEvent !== "push") { res.writeHead(200); res.end(`Ignored: ${ghEvent}`); return; }
    if (glEvent && glEvent !== "Push Hook") { res.writeHead(200); res.end(`Ignored: ${glEvent}`); return; }
    if (bbEvent && !bbEvent.startsWith("repo:push")) { res.writeHead(200); res.end(`Ignored: ${bbEvent}`); return; }

    const data = extractPushData(req.headers, body.json);

    console.log("");
    console.log("========================================");
    console.log(`  PROVIDER:  ${data.provider}`);
    console.log(`  REPO:      ${data.repoUrl}`);
    console.log(`  BRANCH:    ${data.branch}`);
    console.log(`  PUSHER:    ${data.pusher}`);
    console.log(`  COMMITS:   ${data.commits.length}`);
    console.log(`  FROM:      ${data.before.slice(0, 12)}`);
    console.log(`  TO:        ${data.after.slice(0, 12)}`);
    console.log("----------------------------------------");

    for (const c of data.commits) {
        const msg = (c.message || "").split("\n")[0];
        console.log(`  * ${c.id?.slice(0, 12) || "?"} ${msg}`);
    }

    console.log("----------------------------------------");
    console.log("  FILE MODIFICATI:");

    if (data.allAdded.length) data.allAdded.forEach((f) => console.log(`    [A] ${f}`));
    if (data.allModified.length) data.allModified.forEach((f) => console.log(`    [M] ${f}`));
    if (data.allRemoved.length) data.allRemoved.forEach((f) => console.log(`    [D] ${f}`));

    if (data.allFiles.length === 0) console.log("    (nessun file)");
    console.log("========================================");
    console.log("");

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
}

const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const host = req.headers.host || "localhost";
    const url = new URL(req.url || "/", `http://${host}`);
    if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
        return;
    }
    if (req.method === "POST" && url.pathname === "/webhook") {
        void handleWebhook(req, res);
        return;
    }
    res.writeHead(404);
    res.end("Not found");
});

server.listen(PORT, () => {
    console.log(`Webhook server → http://0.0.0.0:${PORT}/webhook`);
    console.log(`Health check   → http://0.0.0.0:${PORT}/health`);
});
