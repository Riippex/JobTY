# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security issue in JobTY, please **do not** open a public GitHub issue.

Instead, report it privately by emailing:

**security@jobty.dev** (or via GitHub's private vulnerability reporting)

Please include:

- A description of the issue
- Steps to reproduce
- Potential impact
- Any suggested fix if you have one

## Response Timeline

- **Acknowledgement:** within 48 hours
- **Initial assessment:** within 5 business days
- **Fix or mitigation:** depends on severity

## Disclosure Policy

Once a fix is available, we will:

1. Release a patched version
2. Credit the reporter (unless they prefer to remain anonymous)
3. Publish a summary of the issue and the fix

## Scope

The following are in scope:

- Backend API (`back/`)
- Browser agent and Playwright automation (`back/plugins/`)
- Frontend dashboard (`front/`)
- Docker configuration

The following are **out of scope**:

- Third-party job board platforms (LinkedIn, Indeed, etc.)
- Issues in upstream dependencies — report those directly to their maintainers

## Notes on Credentials

JobTY handles sensitive user data including job board credentials. If you find any issue related to credential storage or transmission, please treat it as high severity and report it privately.