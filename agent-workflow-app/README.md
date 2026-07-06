# Agent Workflow App

This sample app demonstrates a simple multi-agent workflow using a Writer agent and a Reviewer agent. The framework is intentionally extensible so you can plug in real AI providers, prompt templates, or additional agents.

## Features

- `WriterAgent` generates an initial draft for a task.
- `ReviewerAgent` reviews the draft and proposes improvements.
- `WorkflowEngine` orchestrates the write-review-refine cycle.

## Getting Started

1. Change into the app folder:
   ```powershell
   cd agent-workflow-app
   ```
2. Install dependencies:
   ```powershell
   npm install
   ```
3. Optionally configure OpenAI credentials:
   - Copy `.env.example` to `.env` and fill in your OpenAI API key.
   - Set `OPENAI_MODEL` to override the default model (defaults to `gpt-4.1-mini`).

4. Run the sample workflow:
   ```powershell
   npm start
   ```
5. Run tests:
   ```powershell
   npm test
   ```

## Local Launch

For an offline-capable local setup, run the workflow through Ollama:

```powershell
copy .env.example .env
npm run launch:check
```

See `LAUNCH.md` for the full first-node and XPS 13 setup path.

To check the future Pi 5 mesh bridge:

```powershell
npm run bridge:check
```

To talk to the agents in a persistent command center:

```powershell
npm run interactive
```

## Extending the framework

This sample app supports mock, OpenAI, and Ollama providers. Add new agent roles in `src/Agent.js` and route them through `WorkflowEngine`.
