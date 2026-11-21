# Levuvo Software Factory

A local software factory: AI agents (Claude CLI) build software in hardened Docker containers, following a deterministic workflow. A human approves specifications and decisions and authorizes merges; the factory executes authorized merges.

Status: concept phase, implementation started. The playbook and workflow specify the intended factory behavior. Implemented so far: the factory base in [factory/](factory/) (local Forgejo and the egress proxies); everything else is not implemented yet.

- [ROADMAP.md](ROADMAP.md) – what is done, in progress and planned.
- [PLAYBOOK.md](PLAYBOOK.md) – the rules every run follows: agent rules, enforcement mechanisms, verification requirements and agent instructions.
- [WORKFLOW.md](WORKFLOW.md) – the workflow from idea to released software, step by step; its [Version 1 scope](WORKFLOW.md#version-1-scope) says what the first implementation builds.
- [AGENTS.md](AGENTS.md) – the agents of each workflow step: skill, factory tools, run profile and output.
- [skills/](skills/) – one skill per agent step (Agent Skills format).
- [templates/](templates/) – versioned templates and JSON schemas for all workflow artifacts.
- [stacks/](stacks/) – the supported stack profiles (commands, services, gates, test interface, agent conventions).
- [factory/](factory/) – the factory's own Docker Compose stack: start, check and stop it as described in its README.
