# AutoQA
Open source autonomous LLM agnostic and AST oriented QA web UI testing agent via browser.

---

## 📁 Modules

| File | Purpose |
|------|---------|
| **[src/types.ts](src/types.ts)** | Type definitions and Zod schemas (AgentState, WebAction, DomainStatus) |
| **[src/ast.ts](src/ast.ts)** | DOM AST extraction, conversion to compact LLM format |
| **[src/domains.ts](src/domains.ts)** | Domain tracking, completion validation, cookie vs result detection |
| **[src/tokens.ts](src/tokens.ts)** | LLM token counters, consumption estimation and logging |
| **[src/locators.ts](src/locators.ts)** | Fuzzy DOM element resolution with text fallback |
| **[src/nodes.ts](src/nodes.ts)** | LangGraph nodes (observe, decide, execute) |
| **[src/index.ts](src/index.ts)** | Entry point, LLM setup and graph compilation |
| **[src/modelController.ts](src/modelController.ts)** | Multi-provider LLM factory (openai, anthropic, google, ollama, lmstudio) |

---

## Execution Flow

```
index.ts (run)
    ↓
launch browser → register page instance
    ↓
[LangGraph Loop - recursionLimit: 100]
    ↓
observe ← extract compact AST from current DOM
    ↓
decide ← LLM analyzes AST and objective, chooses action toward target domain
    ↓
execute ← perform action on browser, update state (completed domains, history)
    ↓
check isFinished? → yes: END, no: loop
    ↓
finally: logSessionTokenSummary() and cleanup
```

---

## Extension Points

- **Change LLM provider**: Modify `getLLM('ollama')` in `index.ts`
- **Add domains**: Automatically detected from `OBJECTIVE` string
- **Customize actions**: Extend switch in `executeNode` (src/nodes.ts)
- **Adjust AST compaction threshold**: Change `1200` in `ast.ts` `extractSimplifiedDOM`
- **Adapt completion logic**: Modify `isDomainComplete()` in `domains.ts`

---

## Implemented Optimizations

- **Compact AST**: Reduces tokens ~60-70% vs raw JSON (format: agentId|tag|text|attributes)
- **Fuzzy Fallback**: Avoids failures on dynamic DOM via text regex matching
- **Domain Guard-Rails**: Prevents infinite loops between sites, enforces execution order
- **Navigation Retry**: Handles "Execution context destroyed" on page transitions
- **Real-Time Token Tracking**: Monitor LLM cost per iteration, debug performance

