# AutoQA
Open source autonomous LLM agnostic and AST oriented QA web UI testing agent via browser.

## First principles

- **LLM AGNOSTIC**: you can chose your LLM provider: Ollama, Google, Anthropic, OpenAI, LM Studio
- **GIT PROVIDER AGNOSTIC**: Chose where your code is hosted: GitHub, GitLab, Bitbucket, Gilab support also on premises instances

This makes autoQA suitable for enterprise environments where you may have restrictions on which LLM provider you can use and where your code is hosted due to NDA, DPA or other legal requirements.

---


HOW DOES THIS AGENT NODES WORK UNDER THE HOOD?
```
AGENT'S EYES            -   observeNode   - this node reads the page content and extract it for the decideNode
AGENT'S BRAIN           -   decideNode    - this node handles the reasoning part where the LLM choses what tool it needs to invoke in order to complete the current task
AGENT'S ARMS AND HANDS  -   executeNode   - this node calls the actual tools
```