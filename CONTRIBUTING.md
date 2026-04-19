# Contributing to JobTY

Thank you for taking the time to contribute! JobTY welcomes contributions from developers of all backgrounds and experience levels.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Adding a Job Board Plugin](#adding-a-job-board-plugin)

---

## Code of Conduct

This project follows our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

---

## Getting Started

1. **Search existing issues** before opening a new one — your idea or bug may already be tracked.
2. **Open an issue first** for any significant change (new feature, plugin, or architectural decision) so we can discuss it before you invest time coding.
3. **Small fixes** (typos, docs, minor bugs) can go directly to a PR without an issue.

---

## How to Contribute

### Reporting Bugs

Use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) template. Include:
- Steps to reproduce
- Expected vs. actual behavior
- Your environment (OS, Docker version, LLM provider)

### Suggesting Features

Use the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) template.

### Submitting Code

- One PR per feature or fix — keep scope tight.
- Link the PR to the issue it resolves (`Closes #123`).
- All new services and plugins require tests.
- Update documentation if your change affects behavior.

---

## Development Setup

### Prerequisites

- Docker + Docker Compose
- Python 3.11+ (for running backend tests locally)
- Node.js 20+ (for running frontend tests locally)

### Steps

```bash
git clone https://github.com/Rapd33/JobTY.git
cd JobTY
cp .env.example .env
# Fill in your .env (LLM_PROVIDER + SECRET_KEY at minimum)
docker compose up
```

### Running Tests

```bash
# Backend
cd back
pip install -r requirements.txt
pytest

# Frontend
cd front
npm install
npm test
```

---

## Pull Request Process

1. Fork the repo and create your branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Make your changes following the [Coding Standards](#coding-standards) below.
3. Ensure tests pass locally.
4. Open a PR using the PR template and fill in all sections.
5. A maintainer will review within a few days. Address feedback promptly.
6. Once approved and CI passes, a maintainer will merge it.

---

## Coding Standards

### Python (backend)

- Type hints on all functions.
- Pydantic v2 for all input/output models — no raw `dict` in responses.
- All routes and services must be `async`.
- Never import `openai`, `groq`, or `ollama` directly — use `llm_provider`.
- Follow [PEP 8](https://pep8.org/). Run `ruff` before committing.

### TypeScript (frontend)

- No `any` — explicit types everywhere.
- Server Components by default; `"use client"` only when required.
- Tailwind for all styling.
- `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WS_URL` for backend URLs — never hardcoded.

### General

- No commented-out code in PRs.
- Comments only when the *why* is non-obvious — not the *what*.
- Keep PRs focused. Refactors and features in separate PRs.

---

## Adding a Job Board Plugin

JobTY uses a plugin system so new boards can be added without touching the core.

1. Create `back/app/plugins/your_board.py`.
2. Inherit from `BaseBoard` and implement `search()`, `apply()`, and `scrape()`.
3. Register the plugin in `ENABLED_BOARDS` env var.
4. Add integration tests using pre-recorded fixtures (no live network calls in CI).
5. Document anti-bot considerations specific to the board in your PR description.

See `back/app/plugins/linkedin.py` as a reference implementation.

---

## Questions?

Open a [GitHub Discussion](https://github.com/Rapd33/JobTY/discussions) — issues are for bugs and features only.
