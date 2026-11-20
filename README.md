# Levuvo Software Factory

A local software factory: AI agents (Claude CLI) build software in hardened Docker containers, following a deterministic workflow. A human approves specifications and decisions and authorizes merges; the factory executes authorized merges.

Status: concept phase. The playbook and workflow specify the intended factory behavior; implementation and guard verification have not started.

- [PLAYBOOK.md](PLAYBOOK.md) – the rules every run follows: agent rules, enforcement mechanisms, verification requirements and agent instructions.
- [WORKFLOW.md](WORKFLOW.md) – the workflow from idea to released software, step by step.
