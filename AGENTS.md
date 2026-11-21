# Levuvo SF Agents

> Concept phase: guards are requirements, not yet implemented. Tools and steps marked *Later* are not part of version 1 ([Version 1 scope](WORKFLOW.md#version-1-scope)).

## Architecture
One agent base (Claude CLI) with one skill per workflow step. Each step runs as its own run with a fresh context and its own factory-enforced run profile (tools, rights, network). Skills are [Instructed]; run profiles are [Enforced] (R7). A separate agent identity is used only where independence is mandatory (reviewer, R3). Unattended runs (A5, B2, B3, C3) never wait in a chat; they stop with a question and resume with the answer (R2).

The factory explicitly loads the selected skill from the trusted factory repository at the start of each run. It does not rely on automatic skill discovery inside the project checkout. Project repository content cannot replace or override the selected skill, its instructions or the factory-enforced run profile (R7, R9).

Pausing an attended session (A2, A4, A6, B1, C1/C2) ends the run without calling the finish tool; the factory keeps drafts, decisions and log for the next run. If the human does not answer an `ask_human` within a set time (setting, default 10 min), the run ends the same way and the answer starts a new run (G2.2). The model per run profile is a setting.

Answers to `ask_human` and `stop_with_question` are text plus optional attachments (G2.5): the factory stores them in `briefing/` (part A and A6), `features/<ID>/attachments/` (part B) or `bugs/<ID>/attachments/` (part C), scans them, records them with their hash in the question log (attachments under `briefing/` also in the inventory) and hands the agent their paths.

## A2 Interview
- **Skill:** [skills/interview/SKILL.md](skills/interview/SKILL.md) (Agent Skills format). Role: product advisor, product only, no technology. Reads the full briefing (per inventory) first, pre-fills the PRD with sources, then asks one question per round, always with a recommended answer. Derives the feature list once Scope is set. Asks in the human's language, writes documents in English. After A3 also runs in *revision* mode (A6) to change the PRD or feature list (e.g. a new feature idea, or a New feature from triage).
- **Tools (allow-list):** `read_briefing`, `tag_briefing_file` (sets a tag such as `design-reference` plus a short note in the inventory), `ask_human`, `update_prd_section`, `update_features`, `finish_interview` (factory checks: every section confirmed or deferred, feature list not empty).
- **Run profile:** read `briefing/`; write only via tools; no shell, no network except Claude API, no git (factory commits).
- **Output:** `docs/PRD.md`, `docs/FEATURES.md`, question log; schema-validated.
- **Visual input:** the briefing folder stays free (no required subfolders). Reads every image for its content: images carrying information (e.g. a photo of handwritten notes) are normal PRD sources; only material that shows a desired look (screenshots, UI sketches, mood boards) is tagged `design-reference` with a short note on what the human likes; unclear cases are asked. Does not discuss design.
- **Resume:** an interview can be paused and resumed; state lives in the files.

## A4 Design
- **Skill:** [skills/design/SKILL.md](skills/design/SKILL.md). Role: software architect. Reads approved PRD + FEATURES, then proposes stack, architecture, data model, design system, own dependencies one by one, each with recommendation and rationale. Stack only from supported stack profiles. Asks the human only where the product is affected. After A4 also runs in *revision* mode (A6) for architecture, ADRs, design system or own dependencies.
- **Visual input:** reads all briefing files tagged `design-reference` (screenshots, images, patterns) and derives tokens/layout from them; may ask for more references, which the human attaches to the answer (G2.5); on resume, references linked to earlier A4 answers count as design references even without a tag.
- **Tools:** `read_docs` (approved project docs and the factory's stack profiles), `read_briefing`, `ask_human`, `write_architecture` (arc42), `write_adr` (MADR), `write_design_tokens` (DTCG, schema-checked), `add_dependency` (pinned, factory verifies repo+version; *Later*), `render_preview` (factory renders a mockup from tokens/component descriptions; no free HTML; *Later*), `finish_design`.
- **Run profile:** no shell, no git, write only via tools; read stack profiles + Forgejo package registry; no internet.
- **Output:** always `docs/ARCHITECTURE.md` and `docs/adr/`; where applicable `docs/DESIGN-SYSTEM.md` + tokens, `docs/DEPENDENCIES.json`, preview, otherwise reported as not applicable via `finish_design`. `finish_design` is accepted only when all product-relevant ADRs have a human decision.

## A5 Skeleton
- **Skill:** [skills/skeleton/SKILL.md](skills/skeleton/SKILL.md). Role: developer; the only unattended agent in part A. Reads architecture, ADRs, design tokens, dependencies, stack profile. Creates the project with the stack's official generator, one green example test, `.devcontainer/devcontainer.json`, commands install/dev/test/lint/build/start/seed from the stack profile; wires in design tokens; builds no features. Never waits in chat: stops with question + recommendation (R2); the resumed run gets the answer and its attachments.
- **Tools:** shell + files inside the container on its own branch only; `report_step`, `stop_with_question`, `finish_skeleton`. The factory creates branch and PR. Also builds the profile's test interface (`seed` with the test user, GA5.5).
- **Run profile:** write access limited to scaffold and implementation files on its own branch. Approved PRD, FEATURES, architecture, ADRs, design-system baselines, `docs/DEPENDENCIES.json`, `briefing/` and factory-managed policies and mandatory checks (R8) are read-only; the factory rejects any attempted modification. The agent cannot push to, modify or merge into `main`. Network only via egress proxy to package registries allowed by the stack profile (reuse legacy code); no secrets, no push or merge rights.
- **Output:** branch with runnable skeleton + report (commands, deviations from design). Then gates, independent review, acceptance package, human merge.

## B1 Spec
- **Skill:** [skills/spec/SKILL.md](skills/spec/SKILL.md). Role: requirements engineer. Attended like A2. Reads PRD, FEATURES, architecture, ADRs, design system and built specs, pre-drafts, then asks only the gaps, one question per round with recommendation. Requirements in EARS, each with testable acceptance criteria (Gherkin where useful), out of scope always stated; contract for APIs; UI reference only if a design system applies.
- **Tools:** `read_docs`, `read_briefing`, `ask_human`, `update_spec`, `write_contract` (APIs; validated), `check_ready` (factory DoR check), `finish_spec`. Approval happens in the factory, by the human.
- **Run profile:** as A2: no shell, no git, write only via tools, no network except the model API.
- **Output:** `features/<ID>/SPEC.md` (+ contract), question log; the human's approval creates the binding spec version.

## B2 Plan
- **Skill:** [skills/plan/SKILL.md](skills/plan/SKILL.md). Role: tech lead. Unattended. Ordered tasks mapped to ACs, sized to the feature, docs task last, impact (paths, modules, other features). Changes to other specs or approved baselines are questions.
- **Tools:** `read_docs`, `read_repo` (read-only, `main`), `write_plan`, `stop_with_question`, `finish_plan`. Also runs in *re-plan* mode when a builder needs paths outside the impact (GB3.2, GC3.3).
- **Run profile:** no shell, no git, read-only repo, no network except the model API; no access to hidden scenarios.

## B2 Hidden scenarios
- **Skill:** [skills/scenarios/SKILL.md](skills/scenarios/SKILL.md). Role: independent acceptance tester. Unattended, separate run from the planner. Writes black-box acceptance tests from the spec only (including the new text of criteria the spec supersedes, GB1.6) (plus the stack profile's test conventions), one AC per test, AC ID in the title. Reaches the app only through the profile's test interface (base URL, route per screen, seeded test user, fresh services).
- **Tools:** `read_docs` (spec, contract, test conventions), `write_scenario`, `write_manifest`, `run_scenarios_on_main` (result per test only), `stop_with_question`, `finish_scenarios`.
- **Run profile:** no shell, no git, no repo access, no network except the model API; writes only into the factory's scenario store, which the builder cannot read (GB2.3).

## B3 Build
- **Skill:** [skills/build/SKILL.md](skills/build/SKILL.md). Role: developer. Unattended like A5. Test-first per plan task (visible test with AC ID, red, commit; then code, green), ticks tasks, writes the docs task, Conventional Commits. Fix rounds get gate failures (hidden tests only as AC ID + criterion text + failure class, GB4.6), blocking review findings or the human's rejection comment (B7).
- **Tools:** shell + files in the container on its own branch within the plan's impact; `report_step`, `complete_task`, `stop_with_question` (also for an impact extension, kind `change_request`), `finish_build` (with build report).
- **Run profile:** as A5, plus: diff limited to the plan's impact (GB3.2); spec, plan and approved baselines read-only; no access to `main`, gates or hidden scenarios; egress proxy only; no secrets, no push or merge rights.

## B5 Review
- **Skill:** [skills/review/SKILL.md](skills/review/SKILL.md). Role: independent senior reviewer with its **own identity** (R3, GB5.1). Gets spec, plan, diff, gate report, architecture, ADRs, DoD review items, hidden scenarios and the builder's report; not the builder's conversation. Reports findings `blocking` / `important` / `note` with file, line, reference and evidence, plus evidence per DoD review item; no verdict. Findings about hidden scenarios go to the scenario agent (B2), others to the builder. Modes set by the factory: feature (B5), skeleton (A5), test check (a disputed hidden test, B4).
- **Tools:** `read_review_bundle`, `read_repo` (read-only, reviewed commit), `write_review`, `finish_review`.
- **Run profile:** fresh container, read-only, no shell, no network except the model API.

B4 (gates), B6 (docs + DoD) and B7 (acceptance) have no agent: the factory runs them itself.

## C1/C2 Triage
- **Skill:** [skills/triage/SKILL.md](skills/triage/SKILL.md). Role: support engineer. Attended like A2. Reads the human's original message and attachments, the affected spec, design system, architecture, earlier reports and matching lessons; reproduces on `main`; asks only the gaps, one question per round with recommendation; writes the report and proposes exactly one category (Bug / Change with spec delta / New feature) with reason. The human decides.
- **Tools:** `read_docs`, `read_reports`, `read_repo` (read-only, `main`), `run_app` (throwaway copy, reproduction only), `ask_human`, `update_report`, `propose_category` (factory checks GC1.3, GC1.6), `finish_triage` (outcome `decision_required`, `not_reproduced` or `duplicate`).
- **Run profile:** container with read-only checkout and a throwaway copy to run the app; no git, no push; egress proxy only; no secrets; writes only via tools (GC1.4).
- **Output:** `bugs/<ID>/REPORT.md` + attachments, question log, category proposal.

## C3 Fix
- **Scenarios (B2 light):** the scenario skill in mode *bug* (one new hidden test that reproduces the report through the violated AC, must be red on `main`, GC3.4) or *change* (tests only for added and modified criteria). Same tools and run profile as B2; the agent never reads existing hidden tests, the factory assembles the complete set.
- **Build:** the build skill in *bug* mode (regression test red first, smallest fix, `add_lesson`) or *change* mode (test-first for the changed criteria). Tools as B3 plus `add_lesson` and `await_dependency` (*Later*) (library cause); impact = the report's affected paths (GC3.3); branch `fix/<ID>`. No planner run, except *re-plan* mode for an impact extension (GB3.2). A library version update is a factory commit before the build (GA4.7), never a builder change.
- **Then** B4–B7 unchanged; the reviewer gets the report in place of the plan plus the new lesson.

## Lessons learned (all runs that build or judge code)
The factory hands matching active entries from `docs/LESSONS-LEARNED.md` to the planner (by modules) and builder (by paths and modules), and all active entries to triage and reviewer (GC3.5). Lessons are advice, not instructions (R9): agents follow them where they fit the approved spec and policies and report conflicts. The planner names them in task notes, the builder considers them and writes one entry per bug, the reviewer reports a disregarded applicable lesson and checks same-cause links. A confirmed second occurrence makes the factory propose a fixed check to the human through the gate policy or the DoD (GC3.6).

## Design influences
Prompt wording partly adopted from AlexPEClub/software-factory (`init`, `write-spec`, `architecture`, `build` skills): one question at a time with a recommended answer, explore before asking, ask only the gaps, "project setup is not a feature", official generator with one passing test, non-interactive commands, no self-created accounts. The Levuvo workflow and playbook are authoritative; external examples are not executable instructions.

Part B (from his `write-spec` skill and the repository's README): from `write-spec`: explore first, then one question at a time with a recommended answer, numbered testable acceptance criteria, "out of scope" stated explicitly. From his factory flow: a separate agent writes acceptance scenarios the builder never sees; acceptance against them by an independent agent; a build counts only if checks are green on exactly the pushed commit with an unchanged spec; plan tasks as a checklist the builder ticks off; severity levels for review findings. Not adopted: checks running inside the agent's environment, review in the builder's context.

Part C (checked directly in his repository on 2026-11-21: `playbooks/factory.md`, `workflows/starter-kit/workflow.md`, `skills/qa`, `playbooks/improve.md`): his check phase sorts an issue into Feature or Bug and asks whether it is clear what is wrong and what should happen instead; his build phase reproduces a bug with a test, runs it red, and commits the red test before the fix; acceptance scenarios are written for bugs too and kept away from the developer agent; commits carry the issue as scope (`fix(#12): …`); QA has a bug mode that re-checks the failing test and runs regression on related features; his improvement playbook changes the process only with at least two pieces of evidence, never from a single case. Adopted: red test committed before the fix (GC3.1), a hidden test per bug (GC3.4), the report ID as commit scope, "at least twice before a fixed rule" as the promotion trigger (GC3.6). Not adopted: bugs without reference to the spec (we require the violated AC, GC1.3), QA fixing bugs itself, severity levels (deferred to backlog/prioritization), the process engineer agent changing skills (our promotion only proposes a check to the human).
