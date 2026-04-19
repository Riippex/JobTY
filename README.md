# JobTY

> Autonomous AI agent that searches and applies to jobs on your behalf.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://www.python.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black.svg)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-green.svg)](https://fastapi.tiangolo.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

## What is JobTY?

JobTY is an open-source autonomous AI agent that automates your job search end-to-end. Upload your CV, configure your preferences, and let the agent browse job boards, evaluate offers using LLMs, research companies, and apply — all without manual intervention.

**Privacy-first:** your data stays local. Use Ollama to run models on your own machine with zero data leaving your network.

---

## Features

- **CV Parser** — extracts skills, stack, and experience from your PDF using LLMs
- **Job Scorer** — rates each offer against your profile (0–100 fit score with reasoning)
- **Company Researcher** — generates culture summaries, tech stack, and red flags per company
- **Autonomous Bot** — navigates and fills forms on real job boards using Playwright
- **Live Dashboard** — real-time feed of what the agent is doing via WebSocket
- **LLM Agnostic** — works with OpenAI, Groq, or local Ollama models
- **Plugin System** — add new job boards without touching the core

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 + Tailwind CSS + TypeScript |
| Backend | FastAPI (Python 3.11+) |
| Automation | Playwright + Browser-use |
| AI | OpenAI / Groq / Ollama (switchable) |
| Database | SQLite (dev) → PostgreSQL (prod) |
| Infra | Docker + Docker Compose |

---

## Quick Start

### Prerequisites

- [Docker](https://www.docker.com/get-started) and Docker Compose
- An LLM API key (OpenAI or Groq) **or** [Ollama](https://ollama.com/) running locally

### 1. Clone the repo

```bash
git clone https://github.com/Rapd33/JobTY.git
cd JobTY
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in at minimum:

```bash
LLM_PROVIDER=openai        # or ollama / groq
OPENAI_API_KEY=sk-...      # skip if using Ollama
SECRET_KEY=your-random-secret-key-here
```

### 3. Run

```bash
docker compose up
```

- Frontend: [http://localhost:3000](http://localhost:3000)
- Backend API: [http://localhost:8000](http://localhost:8000)
- API Docs: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## Using Ollama (no API key required)

```bash
ollama pull llama3
```

In your `.env`:

```bash
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_MODEL=llama3
```

---

## Configuration

All configuration is done via environment variables. See [`.env.example`](.env.example) for the full reference with descriptions.

Key options:

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `openai` | `openai`, `groq`, or `ollama` |
| `MAX_APPLICATIONS_PER_RUN` | `20` | Max applications per agent run |
| `ENABLED_BOARDS` | `linkedin,indeed` | Comma-separated list of job boards |
| `PLAYWRIGHT_HEADLESS` | `true` | Set to `false` to watch the bot in action |

---

## Project Structure

```
JobTY/
├── back/               # FastAPI backend
│   └── app/
│       ├── routers/    # REST endpoints
│       ├── services/   # Business logic + AI layer
│       ├── plugins/    # Job board plugins
│       └── models/     # Pydantic models
├── front/              # Next.js dashboard
│   └── src/
│       ├── app/        # App Router pages
│       ├── components/ # React components
│       └── hooks/      # Custom hooks (WebSocket, API)
├── docs/               # Public documentation
├── docker-compose.yml
└── .env.example
```

---

## Roadmap

- [x] Project structure and planning
- [ ] Phase 1 — Base: Docker, JWT auth, CV upload
- [ ] Phase 2 — AI brain: CV parser, job scorer, company researcher
- [ ] Phase 3 — Autonomous bot: Playwright, job board plugins, WebSocket feed
- [ ] Phase 4 — Polish: CI/CD, full docs, public demo

---

## Contributing

Contributions are welcome from developers of all backgrounds and languages.

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

Key points:
- Open an issue before starting significant work
- One feature or fix per PR
- Tests are required for new services and plugins

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

## Disclaimer

This tool is intended for personal use to assist with legitimate job applications. Use it responsibly and in accordance with the terms of service of each job board. The authors are not responsible for misuse or account bans resulting from excessive automated activity.
