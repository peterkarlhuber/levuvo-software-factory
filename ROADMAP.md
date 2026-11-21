# Roadmap

One line per item: what it is and where it stands. An item is worked out only when it is due. This file is updated with every building block. Not listed: ongoing upkeep (updates of the Claude CLI, Forgejo and images, security fixes, lessons from real projects).

## Done
- Concept part A: new project (briefing, interview, PRD, design, skeleton) – PR #1
- Concept part B: feature workflow B1–B7 – PR #2
- Concept part C: bug or change – PR #3
- Self-audit and ChatGPT audit findings closed – PR #4
- Version 1 scope marked in the concept, switchable billing (API or subscription) – PR #5
- Concept part D: backlog and prioritization; model and effort per role – PR #6
- V1 UI mockup chosen: variant A "Inbox first"
- Block 1: factory base (local Forgejo, egress proxies) – PR #7
- Block 2: first isolated agent run (interviewer A2) through the factory API and model gateway – PRs #8, #9, #10, #12
- Web search for the interviewer (owner opt-in) – PR #11

## In progress
- Block 3: minimal web UI (Inbox first, live PRD, answers with attachments, per-project web search)

## Next (V1)
- iPhone access via Tailscale with sign-in – right after block 3
- Block 4: the rest of parts A and B (A3–A6, B1–B7) with the CI gates in Forgejo, incl. a "simplest solution that meets the spec" rule in the build and review skills, a complexity limit lint gate, and Playwright browser tests (Chromium + WebKit) in the `nextjs-postgres` stack profile
- Part D: backlog and prioritization
- Part C: bug or change
- V1 check: build a first small real project end to end with the factory
- Set up the home server (GMKtec NucBox) as a second place to run the factory – when it arrives

## After V1
- Stacks discussion (must happen): which stack profiles to add and how – everything possible, but deliberately and targeted
- More languages and industrial/PLC code as new stack profiles
- Import an existing project (ZIP/Git) with a project-specific custom stack profile
- Several repos per project – first try folders in one repo or linked factory projects
- Brainstorm mode: read-only chat about a project; ideas taken go into the backlog through A6
- Own libraries as dependencies
- PRD plausibility check before A3 – only if real projects show it is needed
- Final factory UI design, ideally built by the factory itself
- Lift the V1 simplifications: design preview in A4, license and accessibility gates, "test red before code" check blocking, automatic lesson promotion, prompt-injection detection
- Parallel features
- GitHub archive mirror
- iPhone push notifications
- Part E: hotfix and security-vulnerability path
- Part F: deployment, rollback, monitoring
- Part G: process metrics and cost reports across projects
