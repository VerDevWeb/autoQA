export interface WebhookBody {
    ref?: string;
    before?: string;
    after?: string;
    commits?: Commit[];
    repository?: {
        clone_url?: string;
        git_url?: string;
        ssh_url?: string;
        url?: string;
        git_http_url?: string;
        git_ssh_url?: string;
        links?: { html?: { href?: string } };
    };
    pusher?: { name?: string };
    sender?: { login?: string };
    project?: { git_http_url?: string; git_ssh_url?: string; url?: string };
    user_username?: string;
    user_name?: string;
    push?: {
        changes?: {
            new?: { name?: string; target?: { hash?: string } };
            old?: { target?: { hash?: string } };
            commits?: {
                hash?: string;
                message?: string;
                links?: { html?: { href?: string } };
            }[];
            changes?: {
                new?: { hash?: string };
                old?: { hash?: string };
                added?: string[];
                modified?: string[];
                removed?: string[];
            }[];
        }[];
    };
    actor?: { nickname?: string; username?: string };
}

export interface Commit {
    id?: string;
    message?: string;
    added?: string[];
    modified?: string[];
    removed?: string[];
}

export interface PushData {
    provider: string;
    repoUrl: string;
    branch: string;
    ref: string;
    before: string;
    after: string;
    commits: Commit[];
    pusher: string;
    allFiles: string[];
    allAdded: string[];
    allModified: string[];
    allRemoved: string[];
}
