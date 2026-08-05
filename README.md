# autoQA

An opinionated browser QA agent for real workflows, not a demo wrapper around an LLM. It launches Playwright, reads the page as structured signal, and loops through observe, decide, and execute until the objective is done.

The focus is narrow and practical: catch what the page is actually doing, decide the next move with an LLM, and keep the run grounded in the browser state, console output, network activity, and transient UI feedback.

## Why this exists

Most browser agents fail in the same places: they miss transient state, lose track of what happened, or treat the DOM like a flat blob of text. autoQA is built to stay closer to the execution surface.

It captures the signals that matter to a test run:

- page structure as a compact DOM tree optimized for LLM reasoning (interactive nodes, labels, key attributes, significant ancestors)
- console messages and page errors
- relevant network activity such as fetch, XHR, document, and websocket traffic
- transient UI messages such as toasts, banners, alerts, and status updates

That is enough to make the agent useful on real frontends without pretending it has superpowers it does not have.

## How it works

```mermaid
flowchart LR
	A[Playwright page] --> B[Observe]
	B --> C[Decide]
	C --> D[Execute]
	D --> B
	D --> E{Finished?}
	E -->|No| B
	E -->|Yes| F[End]
```

The runtime is a LangGraph state machine defined in `src/index.ts`:

- `observeNode` turns the current browser state into structured context.
- `decideNode` asks the configured LLM what to do next.
- `executeNode` performs the selected action and updates the state.

The agent keeps looping until the objective is completed or the recursion limit is reached.

### DOM Tree model

`observeNode` generates a simplified AST from the live page and `decideNode` converts it into a compact tree sent to the model.

The compact tree is intentionally structured and denoised:

- interactive and actionable elements first
- key attributes only (`type`, `name`, `placeholder`, `aria-label`, `role`, `value`, `selected`, `options`, `href`, `src`)
- derived label/context from nearby semantic hints
- significant container ancestors to preserve local context
- deduplication and bounded size to avoid prompt bloat
- normalized CSS class aliases (`class1`, `class2`, ...) to reduce noisy dynamic class names

For `<select>` controls, options are serialized as `value=>label` pairs to help the LLM choose the correct value.

## What it can do

The toolset is intentionally concrete:

- click elements using real HTML target attributes (`id`, `name`, `placeholder`, `aria-label`, `role`, `text`, `href`, `tag`, optional CSS)
- fill single fields or multiple fields in one shot
- upload files
- select dropdown options
- press Enter
- navigate to URLs
- wait for dynamic content to settle
- inspect captured network and console logs
- inspect captured transient UI messages
- send a summary email
- mark the run as done when the objective is complete

`agentId` remains available only as a legacy fallback path for compatibility.

That is the real surface area of the agent. If a new capability is not in the code, it is not claimed here.

## Supported models

The entry point currently defaults to `ollama`, but the project is wired for these providers through `modelController`:

- OpenAI
- Anthropic
- Google
- Ollama
- LM Studio

If the selected model does not support native tool calling, startup fails early.

## Repository layout

- `src/index.ts` wires the graph, browser lifecycle, and capture modules.
- `src/nodes/` contains the observe/decide/execute loop.
- `src/tools/browser/` defines browser actions and inspection tools.
- `src/tools/miscellaneus/` contains general actions such as email and completion.
- `src/networkCapture.ts`, `src/consoleCapture.ts`, and `src/uiSignalCapture.ts` collect the runtime signals the agent reasons over.
- `src/ast.ts` builds and compacts the DOM tree for the LLM.
- `src/locators.ts` resolves Playwright locators from real HTML target attributes (with legacy fallback).
- `src/domains.ts` handles navigation-domain sequencing and completion tracking.

## Requirements

- Node.js 20 or newer
- npm
- A Playwright-compatible browser environment

## Run locally

```bash
npm install
```

Development:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Start the compiled output:

```bash
npm start
```

## Configuration

The agent reads its runtime configuration from environment variables and the provider setup in `src/index.ts`.

- `OBJECTIVE` sets the task the agent should complete.
- `RECURSION_LIMIT` caps the graph loop depth.
- `HEADLESS` is currently hardcoded to `false` in the entry point.

Provider-specific credentials should be set in `.env` when needed by the selected backend.

## Webhook automation (GitHub/GitLab)

The project includes a webhook server in [src/git.ts](src/git.ts) that listens for push events and starts the agent when commit messages contain an `autoQA:` instruction.

Example commit message:

```text
autoQA: go on https://my-app.example.com and register with random credentials, then verify you can add a new "Immobile"
```

Available webhook endpoints:

- `POST /webhooks/github`
- `POST /webhooks/gitlab`
- `POST /webhooks/gitlab/onprem`

Run it locally:

```bash
npm run dev:webhook
```

Build and run production output:

```bash
npm run build
npm run start:webhook
```

Environment variables:

- `WEBHOOK_PORT` default `8787`
- `GITHUB_WEBHOOK_SECRET` required for GitHub signature validation (`X-Hub-Signature-256`)
- `GITLAB_WEBHOOK_TOKEN` required for GitLab token validation (`X-Gitlab-Token`)
- `GITLAB_ONPREM_WEBHOOK_TOKEN` optional dedicated token for on-prem endpoint
- `GITLAB_ONPREM_BASE_URL` optional allowlist prefix for on-prem project URL (`project.web_url`)
- `HEADLESS` recommended `true` in server/cloud environments
- `RECURSION_LIMIT` optional agent loop cap

Notes:

- The webhook runner executes objectives sequentially (queue) to avoid multiple Playwright sessions colliding.
- Only push events are processed.
- If no `autoQA:` instruction is found in pushed commits, the event is accepted but no run is queued.

## Project status

This codebase is aimed at people who want a transparent, inspectable agent rather than a platform abstraction. The implementation favors explicit browser actions, observable state, and a small number of well-defined tools.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).