# Levuvo SF Workflow

Status: draft v0.6.0 · 2026-11-21 · Parts A, B, C and D specified · Version 1 scope marked

> This document specifies the intended behavior of the factory. During the concept phase, guards are requirements, not yet implemented or verified controls.

## Overview
- **A. New project (once):** A0 create project → A1 briefing → A2 interview → A3 PRD + feature list → A4 design → A5 skeleton
- **B. Feature (per feature):** B1 spec → B2 plan + hidden scenarios → B3 test-first build + PR → B4 gates → B5 independent review → B6 docs + Definition of Done → B7 acceptance package, human authorizes merge, release version by SemVer
- **C. Bug or change (per report):** C1/C2 triage: report, reproduce, classify as Bug / Change / New feature (human decides) → C3 fix: red regression test first and smallest fix (Bug), or test-first build of the changed criteria (Change) → then B4 gates → B5 review → B6 docs + DoD → B7 acceptance package, human authorizes merge, release version by SemVer
- **D. Backlog (always):** one ordered list of features, changes and bugs in `backlog.json`; the order is the priority and only the human changes it; the next entry starts only after the human releases it; see D.
- **A6 Revise baselines (any time after A3):** PRD and feature list (interview skill, revision mode), architecture / ADRs / design system / own dependencies (design skill, revision mode), DoR / DoD / gate policy (factory form, no agent); see A6.
- **Later:** hotfix and security-vulnerability path (urgent bugs jumping the queue), deployment/rollback/monitoring, process metrics.

Version 1 builds a subset of this concept; see [Version 1 scope](#version-1-scope) below.

Human decision points in part A: approve PRD + feature list (A3), product-relevant ADRs (A4), DoR/DoD (A5). In part B the human decides twice per feature: approve the spec (B1) and authorize the merge (B7). In part C the human decides twice per report: the category (C2) and the merge (B7). Baseline revisions (A6) need the human's approval at any time. In part D the human orders the backlog and releases each entry before work on it starts. Questions an agent cannot answer itself (R2) come on top.

The playbook ([PLAYBOOK.md](PLAYBOOK.md)) holds the rules that apply everywhere. This document describes each workflow step: purpose, input, output, templates and the step-specific guards. Guard marks: [Enforced], [Verified], [Instructed] (see playbook). Standards are named here without versions; the pinned versions are in the playbook's standards table (R10).

---

## Version 1 scope

The concept stays complete; version 1 (V1) is the first version the factory implements. Marks in this repo: **no mark** = in V1 exactly as specified, every [Enforced] and [Verified] guard included; ***V1: …*** = simpler in V1 (instructed or manual instead of enforced); ***Later*** = not in V1.

- **Workflows in V1:** A0–A6 (new project, including baseline revisions), B1–B7 (feature), C (bug or change), D (backlog).
- **One feature at a time:** in V1 at most one feature is in B1–B7; no parallel features. In the backlog (D) at most one entry is `in_progress`, whatever its kind.
- **One stack profile:** only `nextjs-postgres`.
- **Own libraries as dependencies:** later. In V1 A4 marks own dependencies as not applicable; public packages from the stack profile's registries (npm) are used as usual. If the approved PRD really needs an own library, A4 stops and asks the human: use a public package instead, change the requirement through A6, or let the project wait until own libraries are supported. A needed dependency is never marked not applicable.
- **Security, all enforced from the start:** a container per run, no access to the Mac; egress only through the proxy to allowed hosts (model API, npm); no secrets for agents, secret scan on attachments; no agent writes, pushes or merges to `main`; gates and hidden tests protected. Prompt-injection detection is instructed only (R9); its possible damage is limited by the run's rights.
- **Billing:** *API* (default) or the human's Claude *subscription*, switchable by a setting (G7.4); both in V1.
- **Cost and time brakes:** settings with default *no limit* (R12). Runaway protection comes from R13's progress and loop detection, not from a budget.
- **Automatic in V1:** both human approvals bound to the checked state; the CI gates build, lint, visible and hidden tests, secret scan, dependency vulnerability scan (plus the stack profile's type check, conventional commits and AC coverage); independent review; hidden tests including the regression sets of all `done` features; DoD check; changelog and version proposal from the commits; acceptance package with preview.
- **Instructed or manual in V1:** the stack profile keeps its `license` and `accessibility` gates for later, but in V1 the factory does not run them; license check (not a gate; the reviewer checks the licenses of new dependencies); accessibility check (not a gate; reviewer attention against the design system's target); "test was red before the code or fix" (GB3.1, GC3.1) is recorded but does not block; promoting a lesson to a fixed check is proposed by hand through A6, the factory creates no proposal.
- **Comfort in V1:** a simple web UI (Mac Safari, iPhone via Tailscale), purely functional and minimal: projects, agent questions, answers and approvals, acceptance packages; file attachments; pausing and resuming interviews; preview in the acceptance package. The final factory UI (real design, logo, polished Mac and iPhone experience) is a separate later topic, ideally built by the factory itself as one of its first real projects.
- **Later:** parallel features; own libraries as dependencies; more stack profiles; the design preview in A4 (`render_preview`); the GitHub archive mirror; iPhone push notifications; cost reports across projects (part G); the final factory UI; and the parts already listed as later in the overview.

---

## A. New project (once)



### A0 – Create project
The human creates a project in the factory and names it. The factory creates an almost empty repository on the local git server; everything else is created by the steps when needed.

- Initial content: `README.md` (project name + one line, generated). `briefing/` is created with the first A1 upload (git does not track empty folders).
- Added later: `docs/` with PRD, FEATURES (+ `features.json`), ARCHITECTURE, adr/, DESIGN-SYSTEM + `design-tokens.tokens.json`, DEPENDENCIES (A3/A4), `openapi.yaml` (first API feature), LESSONS-LEARNED (+ `lessons-learned.json`, first bug); `backlog.json` in the repo root (A3, D); `.devcontainer/`, code and `CHANGELOG.md` (A5); `features/<ID>/` with spec, plan and attachments (B); `bugs/<ID>/` with report and attachments (C). Structured sources (`*.json`) live in the repo next to the Markdown the factory renders from them; agents change neither, only the factory writes them.
- Guards:
  - GA0.1 [Enforced] The repo is created private on the local Forgejo; the project name must be unique.
  - GA0.2 [Enforced] The factory bootstraps the repo itself and activates branch protection for `main` before any agent gets write access; no agent ever writes to `main` directly.
  - GA0.3 [Enforced] Optional GitHub mirror for archiving only; nothing runs there. *Later.*
  - GA0.4 [Enforced] Baselines approved in part A (PRD, FEATURES, architecture, ADRs, design system, dependencies) and later revisions of them are committed by the factory itself to `main` through the merge queue, right after the human's approval; the factory checks their schemas, no agent writes them. The same applies to bug reports that end in triage (duplicate, handed over as a new feature, closed). Feature specs, plan ticks and the reports of fixes travel with the code on their branch instead (G1.5).

### A1 – Briefing
The human collects everything about the idea in the folder `briefing/`. Any files and any subfolders the human creates: notes, meeting notes, screenshots, images, PDFs, office documents, links. No predefined structure. Files agents cannot read directly are converted by the factory where possible (e.g. HEIC photos to JPEG, office documents to PDF or text); the original stays. The briefing may be rough and incomplete; A2 fills the gaps. Language: the human may write in any language; project artifacts are written in English.

- Input: anything the human uploads.
- Output: `briefing/` folder + briefing inventory.
- Templates:
  - `BRIEFING.md` – optional fill-in template (Idea, Problem, Users, Alternatives, Must-haves, Not wanted, Constraints, Examples, Attachments). No project name (the project already has one).
  - Briefing inventory (JSON, generated by the factory): every file with path, type, size, hash, readable by agents yes/no.
- Guards:
  - GA1.1 [Enforced] The briefing must not be empty: at least one file before A2 can start.
  - GA1.2 [Enforced] The factory generates the inventory itself; A2 records which inventory version it read.
  - GA1.3 [Enforced] Large files are stored via Git LFS.
  - GA1.4 [Verified] Uploaded files are scanned for credentials and secrets before agent access; detection is best-effort and covers text content only (images are not scanned; the inventory says so). [Enforced] Files with detected secrets are blocked until resolved.
  - GA1.5 [Enforced] Files agents cannot read (e.g. video) are marked in the inventory; A2 asks the human about them.

### A2 – Interview
An interview agent reads the whole briefing and clarifies only the gaps with the human. Goal: the product level (what and why) – it fills the PRD live, section by section, from the briefing and the answers. Not feature specs (B1) and not tech/design (A4). This is an attended session: R2's "never wait in a chat" applies to unattended runs; the question format (one question, recommended answer) stays.

Flow: read all readable inventory files → draft every PRD section the briefing already answers (with source) → ask one question at a time with a recommended answer, updating the PRD live → as soon as the scope (PRD section 7) is drafted, derive the feature list live as well, and keep it in sync with later answers (each feature inside the scope; MoSCoW priority as a preliminary classification and dependencies, proposed by the agent, confirmed by the human; the actual work order is the backlog, D) → end when every section is confirmed or listed under "Open questions" by the human.

- Templates: question log (JSON: question, recommendation, answer, attachments, time). The PRD sections (A3) serve as the coverage checklist; each section has a status (open / drafted / confirmed / deferred) and a source.
- Guards:
  - GA2.1 [Enforced] The interview can finish only when every required PRD section is confirmed or explicitly deferred to Open questions by the human, and the initial feature list is non-empty. A merely drafted section is not sufficient.
  - GA2.2 [Enforced] The interview agent cannot write to the repo directly; it delivers PRD section drafts as structured output, the factory writes PRD and log.
  - GA2.3 [Enforced] The log records the inventory version read; while A2 is running, any change to the briefing inventory (added, changed or deleted files) marks the interview as outdated. After the PRD approval (A3) later files never invalidate the interview or the PRD; a product change goes through A6. Exception: files the human attaches to an interview answer (G2.5) are added to the inventory and read at once; they do not mark the interview as outdated.
  - GA2.4 [Verified] Every drafted or confirmed section has a source (briefing file, human answer or attachment).

### A3 – PRD and feature list
The human reviews and approves the PRD (stable, changes rarely) and the initial feature list (living, changes often) together.

- Output: `docs/PRD.md`, `docs/FEATURES.md`.
- Templates:
  - PRD (common PRD sections, informed by the requirements-engineering principles of ISO/IEC/IEEE 29148): 1 Vision, 2 Problem, 3 Users, 4 Alternatives, 5 Goals & success criteria, 6 Non-goals, 7 Scope (major capabilities and boundaries, no feature list), 8 Quality (performance, security, privacy e.g. GDPR, accessibility, languages, devices), 9 Constraints (hosting, budget, deadline, prescribed tech), 10 Open questions. Each section with status and source.
  - FEATURES.md (structured, rendered from JSON): ID, name, one sentence, priority (MoSCoW), depends on, status (set by the factory).
- Guards:
  - GA3.1 [Enforced] PRD approval requires all essential product decisions to be confirmed. Non-blocking open questions may remain only if the human explicitly accepts them as open.
  - GA3.2 [Enforced] The approved PRD is versioned with a hash; agents can only read it. Changes go through a PRD revision approved by the human (A6).
  - GA3.3 [Enforced] Every feature gets a permanent ID that never changes or gets reused.
  - GA3.4 [Enforced] Every feature must fit the PRD scope; a feature outside the scope first needs a PRD revision (A6). (The scope check itself is [Verified] by an agent, the block is enforced.)
  - GA3.5 [Enforced] Feature statuses are set only by the factory's state machine.

### A4 – Design
Based on the approved PRD, the basic technical decisions are made before the first feature is built. Attended session like A2: the agent proposes with a recommendation; the human decides only product-relevant points. Answers may carry attachments (G2.5), e.g. further design references.

Topics: 1 stack (language, framework, database, login, tests, hosting), 2 architecture (building blocks and how they interact), 3 data model, 4 design system (colors, fonts, spacing, components), 5 own dependencies (own repos: other factory projects or GitHub repos).

*V1: only the stack profile `nextjs-postgres`; own dependencies are later and marked not applicable; no design preview (`render_preview` is later), the design system is shown as text and tokens.*

- Output / templates:
  - `docs/ARCHITECTURE.md` – lightweight arc42 documentation, with C4 System Context and Container diagrams where useful (components only if needed); includes the stack and a separate data-model description when applicable. Features later only add changes.
  - `docs/adr/NNNN-title.md` – MADR, one file per decision, marked "product-relevant" or "internal".
  - `docs/DESIGN-SYSTEM.md` + design tokens conforming to the Design Tokens Community Group (DTCG) Format Module, where applicable.
  - `docs/DEPENDENCIES.json` (*Later*) – own dependencies: repo, purpose, pinned version, how it is integrated. Standard path: own libraries are published with SemVer versions to the Forgejo package registry (npm, PyPI, …) and consumed via the normal package manager; GitHub repos are mirrored to the local git server.
- Artifacts that do not apply to the project (e.g. no UI, no database, no own libraries) are marked as not applicable; they are not created as empty documents.
- Stack profiles: the factory supports a fixed list of stacks (idea from Alex's stack packs). Each profile lives in the factory repo as `stacks/<id>/profile.json` (stack-profile schema) plus `stacks/<id>/CONVENTIONS.md` for the agents: image, generator, the commands install / dev / test / lint / build / start / seed, helper services (e.g. a database), allowed public package registries (the factory's local Forgejo registry for own libraries is always allowed in addition), the gate-affecting project files (`gate_config`), the mandatory gates with their fixed commands, and the test interface (test user, fresh services per run, screens by route). A project records the profile id and version in `ARCHITECTURE.md`. A new or changed profile is a change to the factory itself (proposal, human approval, PR), not a workflow step.
- Guards:
  - GA4.1 [Enforced] The stack must match a factory stack profile; otherwise A4 stops until a new profile has been added to the factory. *V1: only `nextjs-postgres`.*
  - GA4.2 [Verified] Every ADR is "product-relevant" (hosting, login, cost, privacy, PRD constraints → human decides) or "internal" (agent decides).
  - GA4.3 [Enforced] Approved architecture, ADR and design-system baselines are versioned and cannot be modified directly by agents. Agents may propose updates through the factory; they are approved as revisions (A6). Significant architectural decisions require new or superseding ADRs; routine documentation and design-system updates do not. Product-relevant changes keep human approval.
  - GA4.4 [Verified] Every decision fits the PRD's quality requirements and constraints.
  - GA4.5 [Enforced] Own dependencies are always pinned to a fixed version. *Later (own dependencies).*
  - GA4.6 [Enforced] Agents cannot modify the source of a separately managed dependency within the consuming project. Changes to the dependency itself belong to its own project. *Later (own dependencies).*
  - GA4.7 [Enforced] Updating the consumed version is a separate change subject to all mandatory quality gates of the project's gate policy (R4). Inside an approved library Bug fix (C3) the factory makes this update itself, and the human's acceptance and merge authorization (B7) cover it; any other change to own dependencies goes through A6. *Later (own dependencies).*

### A5 – Skeleton
First unattended run. The agent builds a runnable, empty project from the design before any feature exists.

The skeleton goes through the normal approval path: feature branch, PR, mandatory gates, independent skeleton review (no hidden scenarios), acceptance package, human-authorized merge. Results are bound to the approved PRD and architecture baseline plus DoD/gate policy (there is no feature spec yet).

Flow: scaffold on a feature branch with the stack's official generator + one passing example test → describe the environment as a Dev Container (`.devcontainer/devcontainer.json`, open standard) → define the profile's commands install / dev / test / lint / build / start / seed (`start` serves the built app; `seed` applies the schema to an empty database and creates only the profile's test user) → the factory proposes DoR and DoD from the stack profile, the human approves → the factory generates the mandatory gates (R4) and Forgejo branch protection from them → the factory checks the skeleton in its own container. Gate report and build report use their *skeleton* mode (no feature, spec or criteria); the acceptance package shows the DoD items instead of acceptance criteria; the first release is version 0.1.0.

- Templates: DoR and DoD (checklists with schema, gates are generated from them), `devcontainer.json` (Dev Container spec).
- Guards:
  - GA5.1 [Enforced] A5 is complete only after all mandatory gates are green in the factory container, the independent review and the Definition of Done passed, and the human-authorized merge succeeded.
  - GA5.2 [Enforced] DoR, DoD and gate policy live in the factory (R8); only the human can change them.
  - GA5.3 [Enforced] Branch protection and merge rights are set by the factory; agents have no merge rights (R3).
  - GA5.4 [Verified] The skeleton contains setup only, no feature logic.
  - GA5.5 [Enforced] The skeleton provides the profile's test interface: with fresh services, `seed` creates the test user and the app is reachable under the base URL; a factory check proves it before the skeleton can be merged.

### A6 – Revise baselines (any time after A3)
Approved baselines change over the project's life: a new feature idea, a changed priority, a new own library, a new design detail, a stricter DoD. They change only through a revision the human approves (GA3.2, GA4.3, GA5.2); no new agents are needed.

- **PRD and feature list:** the interview skill in *revision* mode. Attended like A2. It reads the current approved PRD and feature list and the human's request (e.g. "new feature idea", "change priority", "extend the user groups"), asks only the gaps with a recommendation and proposes the changed sections or feature entries (name, sentence, MoSCoW priority, dependencies, scope reference). A New feature from triage (C2) and a planner or spec agent question that needs the PRD changed start here as well. A new feature idea is usually done after one or two questions.
- **Architecture, ADRs, design system, own dependencies:** the design skill in *revision* mode. Attended like A4. Started by the human, or by an agent's question that the human accepts (e.g. the planner needs a new own library, triage finds a change to the design system as a whole). Significant decisions get new or superseding ADRs (GA4.3).
- **DoR, DoD and gate policy:** no agent. The factory shows the current list, the human edits and approves it (GA5.2); a lesson promotion proposal (GC3.6) lands here.
- **After approval:** the factory commits the new version itself (GA0.4) and lists the features that are not `done` and whose approved spec refers to changed sections, ADRs or design components; their spec must be re-confirmed by the human (or revised in B1) before work continues. `done` features stay unchanged unless a later feature supersedes their criteria (GB1.6).
- Guards:
  - GA6.1 [Enforced] A baseline changes only through a revision the human approves; the revision is a new version bound to its approval, and results bound to the old version are marked outdated only where the factory's impact list names them.
  - GA6.2 [Enforced] Work on a listed affected feature cannot continue until the human has re-confirmed or revised its spec.


---

## B. Feature (per feature)

Every feature runs B1–B7 on its own feature branch. *V1: one feature at a time; parallel features are later.* Everything a step produces is bound to the spec version it was made for (R5): a new spec version restarts the feature at B2. The factory's state machine sets the feature status (GA3.5): `approved` (A3) → `specifying` (B1) → `ready` (spec approved) → `in_progress` (B2–B6) → `in_acceptance` (B7) → `done`; `waiting` while work needs a release of an own library or a baseline revision (A6).

**Changing done features.** A new feature may change criteria of features that are already `done` (e.g. a login in front of all pages) only openly: its spec lists them under *supersedes* (AC, modify or remove, new text, reason), and the human approves this together with the spec (GB1.6). The scenario agent of the new feature writes hidden tests for the new text, the builder visible ones; the factory drops the tests of superseded criteria. With the merge the factory releases new spec versions of the affected features as well (G1.5); they stay `done` and do not restart. Any other change to another feature is a question (R2).

Files per feature: `features/<ID>/SPEC.md` (+ `features/<ID>/openapi.yaml` for APIs, as a change to the project-wide contract `docs/openapi.yaml`) and `features/<ID>/PLAN.md` live in the project repo. After approval the factory commits the spec to the feature branch before B2; it reaches `main` together with the code and becomes the released version with the merge (G1.5). Spec agents, planners and triage read only released specs of other features; hidden scenarios, gate reports and review reports live in the factory, outside the repo the builder can read.

### B1 – Spec
Attended session like A2. A spec agent turns one feature from the feature list into a testable spec; the human approves it. This is the first of the two human decisions per feature.

Flow: B1 starts when the human releases the feature's backlog entry (D2) → the spec agent reads PRD, FEATURES, architecture, ADRs, design system and the released specs of already built features → pre-drafts every spec section it can (with source) → asks only the gaps, one question per round with a recommended answer, updating the spec live; answers may carry attachments (G2.5) → for an API it writes the interface contract with the spec → the factory runs the Definition of Ready check → the human approves the spec.

- Output: `features/<ID>/SPEC.md` (rendered from structured output); for APIs `features/<ID>/openapi.yaml` (OpenAPI, or the format the API-style ADR from A4 names): the endpoints this feature adds or changes. The project-wide contract `docs/openapi.yaml` is updated by the factory on the feature branch from it (created by the first API feature) and travels with the code like the spec (G1.5).
- Templates: SPEC (user stories; requirements in EARS, each with acceptance criteria `AC-<feature>-<nn>`, e.g. `AC-001-01`, Gherkin where useful; out of scope; UI reference only if a design system applies: each screen with its route, the visible labels the criteria rely on and its design-system components; the route is part of the contract the hidden tests use; interface contract only for APIs; open questions). Every acceptance criterion must be checkable by an automated test; what only a human can judge belongs to the Definition of Done.
- Revision: a requirement change later (from B3–B7 or by the human) produces a new spec version through the same session (G1.3), or directly from a question whose chosen option carries the spec delta (G2.4). The factory replaces the spec on the branch (G1.5). Approval of the new version invalidates plan, hidden scenarios, gate and review results of the old version and restarts the feature at B2; existing code on the branch may stay, but is re-planned and checked again in full.
- Guards:
  - GB1.1 [Enforced] Only a feature from the approved feature list can be specified, and only when all features it depends on are `done`.
  - GB1.2 [Enforced] The spec must match its schema: every requirement has at least one acceptance criterion, every criterion has a unique ID and a pass/fail statement. Every user story and requirement names its source. Whether a requirement is a clear EARS sentence and a criterion is really testable is [Verified] by the spec agent's self-check and the human at approval.
  - GB1.3 [Enforced] Approval binds one spec version (content hash). Any change is a new version that needs a new approval (R1, G1.2, G1.3).
  - GB1.4 [Enforced] If the spec would go beyond the PRD scope or contradict an approved ADR, the agent stops and asks; the spec cannot be approved until the PRD or ADR is revised or the spec adjusted. (Detecting the conflict is [Verified] by the agent and the DoR check; the block is enforced.)
  - GB1.5 [Enforced] Approval requires a passed Definition of Ready (A5); blocking open questions prevent approval, non-blocking ones only if the human explicitly accepts them.
  - GB1.6 [Enforced] A spec can change criteria of another feature only through its *supersedes* list: each entry names an existing AC of a `done` feature's released spec, modify or remove, and for modify the new pass/fail text. The factory validates the resulting specs of the affected features like a revision (GB1.2, GB1.4) before approval and releases them with the merge. While an affected feature has an open, not yet released version (e.g. a Change in C3), the approval waits (G1.5: at most one open version per feature).

### B2 – Plan and hidden scenarios
Two separate unattended runs with fresh context, started by the factory after spec approval. They do not see each other's output.

**Plan.** A planner agent reads the approved spec, architecture, ADRs and the code (read-only) and writes the plan: ordered tasks, each mapped to the acceptance criteria it serves, sized to the feature (a small feature is one task). The last task is always "update docs" (README, usage, API description, ADR if needed). The plan lists its impact: files and modules it will change, and other features it touches. If the plan would have to change another feature's spec or an approved ADR, the planner stops and asks (R2). Tasks are a checklist the builder ticks off in B3. In *re-plan* mode (GB3.2, GC3.3) it extends an existing plan's impact for a builder's request; the result is a new plan version.

**Hidden scenarios.** A scenario agent writes executable acceptance tests from the approved spec only (including the interface contract and the stack profile's test conventions; no plan, no code). Tests reach the app only through the profile's test interface: base URL, each screen by the route the spec names, login as the seeded test user, all other data created through the UI or API like a user would; every run starts with fresh, empty services. Each test names the acceptance criterion it checks. The factory stores them outside the project repo (holdout) and uses them in B4; the builder never sees them, the reviewer does (G3.3). The scenario agent can run its own tests against current `main` through a factory tool that returns only passed / failed at assertion / error per test, so it fixes syntax and setup errors itself; after a set number of rounds with errors (setting, default 2) the factory asks the human.

- Output: `features/<ID>/PLAN.md` (rendered from structured output); hidden scenarios + their manifest (factory store).
- Templates: PLAN (tasks with AC mapping and done flag, impact), hidden-scenario manifest (test → AC), tests in the stack's test framework, Gherkin where the stack profile supports it.
- Guards:
  - GB2.1 [Enforced] Every acceptance criterion, including the new text of superseded criteria (GB1.6), is covered by at least one plan task and at least one hidden test; otherwise B3 cannot start.
  - GB2.2 [Enforced] Hidden tests may only reference acceptance criteria of the approved spec version; a test without a valid AC ID is rejected. [Verified] The reviewer checks that a hidden test asserts nothing beyond its criterion.
  - GB2.3 [Enforced] The builder has no read access to the hidden tests (R7).
  - GB2.4 [Verified] Before B3 the factory runs every hidden test against current `main` and records the baseline. A valid red test runs up to its assertion and fails there; a test that errors (syntax, imports, environment) goes back to the scenario agent. A test that already passes (behaviour exists) is recorded and checked by the reviewer for meaningful coverage; it is not changed to fail artificially.
  - GB2.5 [Enforced] Every hidden scenario set has a version with a content hash; baseline, gate and review results are bound to it (R5). A corrected test creates a new version and voids the affected results.

### B3 – Build
Unattended run like A5. A builder agent implements the plan test-first on its own branch.

Flow per task: write the visible tests for the task's acceptance criteria first and commit them (red) → write the code until they are green → run lint and tests with the A5 commands → tick the task in the plan → next task. The last task updates the docs. When all tasks are ticked, the builder finishes with a build report; the factory pushes, opens the PR and starts B4.

- Run profile: own container, own branch, network only via the egress proxy, no secrets; no access to `main`, the gates or the hidden tests; approved spec, plan and baselines are read-only (G1.1, GA4.3).
- Templates: build report (summary for the human, deviations, assumptions, risks, required environment variables); commits follow Conventional Commits.
- Guards:
  - GB3.1 [Verified] Every acceptance criterion has a visible test (named with its AC ID) committed before the code; the factory checks the commit order and that the test failed at its assertion at that commit, unless the behaviour already existed on `main` (GB2.4). *V1: recorded, not blocking.*
  - GB3.2 [Enforced] The diff may only touch what the plan's impact lists; anything else is rejected. The builder asks for an impact extension (change request: paths + reason). The factory grants it automatically for the stack profile's companion files (e.g. lockfile); otherwise the planner runs in *re-plan* mode (new plan version, same spec and hidden scenarios, no builder round used). The human is asked only if the extension touches another feature's spec or a baseline.
  - GB3.3 [Enforced] Error loops stop the run (R13); the number of fix attempts is a setting (M3).
  - GB3.4 [Instructed] Build nothing the spec does not ask for. [Enforced] The build report must list deviations (an empty list is allowed); finishing without it is rejected. [Verified] The reviewer checks for unrequested behaviour (B5).

### B4 – Gates
No agent. The factory checks the PR in the local Forgejo CI, in a fresh, clean container without Docker socket access, with fresh, empty profile services, on the PR as merged onto current `main` (R5, G5.3). Gate commands come from the stack profile, never from project files (G8.2).

- Gates: the mandatory gates, all generated from DoD items (A5, G4.2): build, lint, visible tests, hidden tests, secret scan, dependency vulnerability scan, license check, acceptance-criteria coverage (every AC has a passing visible and hidden test), commit messages (GB6.2); the stack profile adds more (e.g. type check, accessibility check for UI). *V1: license check and accessibility check are not gates; the reviewer covers them (B5).*
- Results: test results as JUnit XML, findings as SARIF; the factory combines them into a gate report with a status per acceptance criterion: passed / failed / not checked.
- Red: the factory sends a builder view of the failures back to B3 automatically. The full gate report stays in the factory; the builder view is generated deterministically and contains, for hidden tests, only the AC ID, the criterion text and a failure class (element missing, wrong value, wrong status, timeout, error), never free text, test IDs, code, paths, fixtures, data or raw traces. After the round limit (setting, R4 default 2) the factory stops and asks the human (R4).
- Disputed hidden test: if the builder reports (as a failure report, not a question to the human) that a hidden-test failure contradicts the spec, or the round limit is reached on a hidden test, the factory first has the reviewer (B5 identity) check that test against its acceptance criterion (review mode `test_check`; it never advances the feature to B6/B7). The human is asked only if the check cannot settle it. An invalid test goes back to the scenario agent (B2), is re-validated (GB2.4) and the gates run again; this does not use a builder round. A valid test stays; the builder gets the next regular gate round.
- Regression: the hidden test sets of all `done` features run as well (without tests of criteria this feature supersedes). A failure there reaches the builder in the same sanitized form: the other feature's AC ID and its criterion text.
- Templates: gate report (per gate and per AC, bound to commit, spec version, gate-policy version).
- Guards:
  - GB4.1 [Enforced] Gates run outside any agent container; agents cannot change, skip or influence them (R8).
  - GB4.2 [Enforced] Every result is bound to commit, spec version and gate-policy version (R5).
  - GB4.3 [Enforced] "Not checked" blocks exactly like "failed" (R6).
  - GB4.4 [Enforced] The factory judges test gates from the JUnit results itself: no test results, fewer visible tests than on `main` (unless the approved spec removed criteria) or a missing AC test count as failed, whatever the exit code.
  - GB4.5 [Enforced] The hidden-test gate includes the current hidden sets of all `done` features (regression); a failure in any of them blocks like a failure of the feature's own tests. The factory keeps one versioned regression manifest in its scenario store (outside the project repo, GB2.3) naming the active set version per `done` feature, without superseded criteria; the gate report records its version, and the manifest including this feature's set becomes active atomically with the merge.
  - GB4.6 [Enforced] The builder view of a failed hidden test is generated by the factory from the JUnit result only: AC ID, criterion text, failure class; no free text (G3.3).

### B5 – Independent review
After all gates are green, a reviewer agent with its own identity checks what gates cannot (R3).

- Input: approved spec, plan, PR diff, gate report, build report (marked as the builder's statements), architecture, ADRs, DoD items to be checked in review, hidden scenarios (G3.3). Not the builder's conversation or reasoning.
- Checks: the spec is really implemented (not just tests green), fits architecture and ADRs, readable and maintainable, security risks, nothing built beyond the spec, docs updated, hidden scenarios plausible.
- Report: findings `blocking` / `important` / `note`, each with file, line and a reference to spec, AC, ADR or DoD item; plus evidence for each DoD review item. Blocking findings about the implementation go back to B3, findings about a hidden scenario go to B2; then B4 and B5 run again; round limit is a setting (R4 default 2). Findings describe behaviour, never quote hidden tests (G3.3).
- Templates: review report.
- Guards:
  - GB5.1 [Enforced] Reviewer and builder are separate runs with separate identities; the reviewer has read-only access.
  - GB5.2 [Enforced] The review is bound to the commit it reviewed and the tree of its merge with `main` at that time (R5); a new push makes it outdated. Whether a later change on `main` requires a new review follows the fixed rule of G5.4.
  - GB5.3 [Instructed] Every finding needs evidence (file, line, reference); matters of taste are never `blocking`. [Verified] The factory rejects findings without location and reference, and a report that does not give evidence for exactly the DoD review items (a missing item counts as not met).
  - GB5.4 [Verified] Before review findings reach the builder, the factory checks them for hidden-scenario details (G3.3) by a text comparison with the hidden test files (longer identical word sequences, test IDs, file names); a hit blocks the finding and sends it back to the reviewer for rewording.

### B6 – Docs and Definition of Done
No agent. Docs were written by the builder in B3 (plan task) and checked by the reviewer in B5. The factory checks the DoD (A5): automated items from the gate report, review items from the review report; human items are listed in the acceptance package. It generates the changelog entry from the commits under `## [Unreleased]`, proposes the change type (major / minor / patch) and adds both as a factory commit to the PR before the acceptance package is built; the gates run on that commit, so the human approves exactly this diff (B7). The factory commit may contain only factory-managed files (changelog, version proposal; in part C also report and lessons learned); the factory checks this by path, so the review of the previous commit stays valid (G5.2).

- Standards: Conventional Commits, Keep a Changelog (`CHANGELOG.md`), SemVer. Version proposal: commits are the input (breaking change → major, `feat` → minor, otherwise patch; below 1.0.0 a breaking change is minor); for APIs the factory also compares `docs/openapi.yaml` on the branch with the one on `main` and a detected breaking change overrides the commit types. The human confirms the change type at acceptance; the version number itself is set at merge (B7, G5.5), so two features approved in parallel do not void each other's approval.
- Guards:
  - GB6.1 [Enforced] An open automated or review DoD item blocks B7.
  - GB6.2 [Enforced] Every commit on the branch follows Conventional Commits (a DoD item every stack profile proposes, checked as a gate).

### B7 – Acceptance
No agent. The factory generates the acceptance package; the human decides. This is the second human decision per feature.

- `ACCEPTANCE.md`, one page, plain language: what is new (2–3 sentences in the human's language, from the build report); each acceptance criterion ✅ passed / ❌ failed / ⚪ not checked (approval only possible if all are ✅, R6); try it: for UI a preview of the branch in a container reachable via Tailscale from Mac and iPhone, plus screenshots; for APIs the rendered OpenAPI docs in the preview; review summary and deviations; DoD items the human confirms; changelog entry, proposed change type (major / minor / patch) and feature cost (R12).
- Decision:
  - **Approve merge:** the factory validates exactly the approved diff (incl. changelog entry) against current `main` (GB7.2). While `main` is locked by the merge queue, it builds the final integration tree with `[Unreleased]` turned into the next version number by the approved change type and today's date (the only mechanical change after approval), runs the final gates on exactly this tree and merges exactly it (G5.5); nothing is modified after the final check. It then tags that commit and marks the feature `done`; for a library project it also publishes the package version to the Forgejo registry (*Later*); the GitHub mirror archives (*Later*). If the human changes the change type, the factory updates the changelog commit, re-runs the gates and asks for approval of the new diff.
  - **Reject with comment:** the human picks one of two buttons and writes a comment. *Not as specified* (code issue): back to B3 (then B4–B7) with fresh fix rounds and the comment as input of the fix round, because the rejection is itself the human's decision under R4 (the factory logs it as such). *Should be different* (requirement issue, including a visual detail): a revision of this feature's spec in B1 (UI reference changes included); the pending spec version is superseded and work restarts at B2. Part C Changes, visual ones included, apply only to released features (G1.5); for a report this button goes back to triage.
- Templates: ACCEPTANCE.md, CHANGELOG.md.
- Guards:
  - GB7.1 [Enforced] Approval is bound to the diff, spec version and gate-policy version shown in the package (R5, G5.5); any change voids it.
  - GB7.2 [Enforced] Right before merging, the factory validates the exact merge result (incl. changelog entry) against current `main`: gates always run again; independent review and renewed human authorization when G5.4/G5.5 require them. Only a result with exactly the tested tree hash is merged.
  - GB7.3 [Enforced] Only the human can authorize the merge (R3).

---

## C. Bug or change (per report)

The human reports a problem in their own words. One triage run turns it into a report and proposes exactly one of three categories; the human decides. A Bug or a Change is then fixed in C3 and goes through B4–B7 exactly like a feature. The human decides twice per report: the category (C2) and the merge (B7).

Every report lives in the project repo, versioned: `bugs/<ID>/REPORT.md` (rendered from structured output), `bugs/<ID>/attachments/`. IDs (`BUG-001`) are permanent and never reused. The factory's state machine sets the report status: `triage` (C1/C2) → `decided` → `in_progress` (C3, B4–B6; `waiting` for a library release) → `in_acceptance` (B7) → `done`, or `closed` (duplicate, handed over as a new feature, or closed by the human). The affected feature stays `done`, bound to its last released spec version. A Change creates an approved, not yet released spec version; the factory commits it to `fix/<ID>` before C3, and it becomes the released version only with the authorized merge (G1.5). While it is open, a further Change to the same feature waits. If the category decision is superseded (e.g. after a B7 rejection), the factory supersedes the pending version and voids the results bound to it.

**Categories** (exactly three are shown to the human):
- **Bug** – the code deviates from the approved spec: a named acceptance criterion is violated.
- **Change** – small, the spec itself changes. The agent proposes a concrete spec delta (add, modify or remove an acceptance criterion or requirement). One decision confirms category and delta; the factory then creates the new spec version itself (G1.3, G2.4). A *visual* Change (size, color, wording of one screen) changes only the spec's UI reference, has no acceptance criterion and no hidden test; the builder works in change mode, and the human confirms it in the preview with before/after screenshots in the acceptance package. A change to the design system as a whole, an approved ADR or the PRD goes through A6 instead.
- **New feature** – a new capability: it is added to the feature list through A6 and specified in B1.

**Handled in the background, not categories:** not reproducible → the agent asks follow-up questions; if it stays not reproducible, the report stays in `triage` until the human adds information or closes it. Duplicate → the agent names the earlier report, the factory links and closes this one. Works as specified → it is a Change or a New feature. Cause in an own library (*Later*) → still a Bug; it is fixed in the library's project (GA4.6): the factory creates a linked report there (triage there starts from this report). In C3 here the factory updates the pinned version to the library's fixed release (GA4.7); the builder adds the regression test and the lesson.

### C1/C2 – Triage
Attended session like A2. Report (C1) and classification (C2) are one run, because the agent needs the reproduction to classify.

Flow: the human describes the problem in their own words, with attachments if they like → the factory stores the message unchanged and the attachments (G2.5) under `bugs/<ID>/` → the triage agent reads the affected spec, design system, architecture, earlier reports and matching lessons learned → reproduces the problem on current `main` in its container (starts the app with the A5 `dev` command, follows the steps) → asks only what is missing (steps, expected behaviour, environment), one question per round with a recommended answer → writes the report → presents one category with reason and recommendation (for a Change the spec delta) → the human decides; they may pick another category and add a comment. The factory validates the prerequisites of the *chosen* category, not only of the proposal (GC1.3, GC1.6); if information is missing (e.g. the human picks Bug but no criterion is named or nothing was reproduced), triage continues until the decision is complete.

After the decision: **Bug** → a backlog entry (kind `bug`) at the end of the backlog (D2); C3 in bug mode starts when the human releases it. **Change** → the factory creates the approved spec version from the confirmed delta (G1.5) and a backlog entry (kind `change`) at the end; when the human releases it, C3 starts in change mode. **New feature** → the interview skill in revision mode adds it to the feature list with the human (A6; outside the PRD scope a PRD revision comes first, GA3.4); the factory links the report and closes it; the new feature gets its backlog entry like any approved feature and is specified in B1 when released.

- Triage ends with one outcome: *decision required* (the three categories are shown), *not reproduced* (the report stays in `triage`) or *duplicate* (linked and closed); only the first creates a category decision.
- Output: `bugs/<ID>/REPORT.md` + attachments; question log.
- Templates: bug report (fields based on IEEE 1044: title, original message, steps to reproduce, expected vs actual, environment, attachments, affected feature + acceptance criteria + paths, reproduction result, classification, decision), question log for the questions.
- Guards:
  - GC1.1 [Enforced] The factory stores the original message unchanged with its hash; the agent cannot write it.
  - GC1.2 [Enforced] Attachments go through G2.5 (stored under `bugs/<ID>/attachments/`, secret scan, recorded with hash in the report) before the agent can read them.
  - GC1.3 [Enforced] A Bug proposal or decision must name the affected feature, its spec version, at least one acceptance criterion it violates and a `reproduced` result; otherwise the factory rejects it. Behaviour no criterion covers is a Change or a New feature.
  - GC1.4 [Enforced] The agent only reproduces: read-only checkout of `main`, the app runs on a throwaway copy inside its container, results leave the container only through tools; no git, no push.
  - GC1.5 [Enforced] Only the human sets the category; the agent's proposal never changes a status (R3, G11.1).
  - GC1.6 [Enforced] A Change decision requires a spec delta shown to the human and binds exactly that delta. Before the decision is offered, the factory validates the resulting complete spec against GB1.2, GB1.4 and GB1.5; the decision approves exactly the validated revision, and the factory publishes it (G1.3, G2.4). If validation fails, the delta is corrected first; a different delta needs a new decision.

### C3 – Fix
Unattended. Before the build, the scenario agent runs once (B2 light, separate run, spec plus report only). It writes only new tests and never reads the existing ones; the factory assembles, versions and validates the complete resulting scenario set (GB2.1–GB2.5):
- **Bug:** it writes one hidden test that reproduces the report through the violated acceptance criterion (AC ID and BUG ID in the title). The factory runs it on `main`: it must fail at its assertion, which is the independent reproduction. A test that passes or errors goes back to the scenario agent; if it still cannot reproduce the bug, the factory asks the human.
- **Change:** it writes tests only for added and modified criteria. A Change that adds or modifies no criterion (visual Change, or only removals) skips the scenario agent; the factory keeps the set (minus removed criteria). The factory drops the tests of modified and removed criteria and carries all other tests over unchanged.

Then the builder (B3 skill, bug or change mode) works on its own branch `fix/<ID>`. There is no planner run (except *re-plan* mode for an impact extension, GB3.2): the paths the report names as affected are the impact, and the work is one task plus docs where user-facing docs are affected.
- **Bug mode:** read the report, the violated criterion and the matching lessons → write a visible regression test (BUG ID and AC ID in its name), see it fail at its assertion, commit (`test(BUG-001): …`) → the smallest fix that makes it green, no side refactorings, commit (`fix(BUG-001): …`) → add a lessons-learned entry (cause, fix, prevention; link an earlier lesson with the same cause) → build report.
- **Change mode:** test-first for the changed criteria exactly as B3, docs, build report.
- **Library cause** (*Later*)**:** the builder first writes and commits the regression test against the currently pinned version (red, GC3.1). Then the factory commits the version update in `docs/DEPENDENCIES.json` to the library's fixed release (GA4.7); the builder verifies that the test is now green and adds the lesson. No library source is changed here. Without a fixed release the builder ends its run with `await_dependency` after the red test; the report is `waiting` until the library's release is published, then the factory commits the update and resumes the builder.

Then B4–B7 as for a feature, with these differences:
- **B4:** gate report carries the report ID; the hidden tests include the new bug test; regression tests of earlier bugs run as normal visible tests.
- **B5:** review in feature mode with the report in place of the plan. Bug: the regression test really reproduces the reported behaviour, the fix addresses the cause and nothing else, the lesson is concrete. Change: code and tests match exactly the approved spec delta, tests of changed criteria are updated, nothing unrelated changed; no lesson is required.
- **B6:** the changelog entry names the report ID. Change type as in B6 (the version number is set at merge): a fix is a patch; a change is a minor version if it adds behaviour, otherwise a patch; a breaking change follows the B6 rule.
- **B7:** the acceptance package says what was wrong and is now fixed (or what changed), lists the affected feature's acceptance criteria and links the report. Reject: a code issue goes back to C3, a wrong category or requirement back to triage for a new decision.

Factory-managed artifacts (report status and links, lessons learned, changelog entry under `[Unreleased]`) are written by the factory in the B6 commit, so they are part of the diff the human approves and the gates check (G5.5). The lesson is written exactly as the reviewer saw it. The report in the repo shows the state at that commit; the factory's state machine is authoritative for the current status and records the merge commit itself. After the merge the factory changes nothing in the report on `main`; only `backlog.json` is updated (D2).

- Run profile: as B3 (container, own branch, egress proxy only, no secrets, no access to `main`, gates or hidden tests); report, spec and approved baselines read-only.
- Templates: bug report, lessons learned, build report (with report ID).
- Guards:
  - GC3.1 [Verified] The regression test (BUG ID and AC ID in its name) is committed before the fix and fails at its assertion at that commit; the factory checks commit order and the run, as in GB3.1. *V1: recorded, not blocking.*
  - GC3.2 [Enforced] A Bug's Definition of Done is not met without a schema-valid lessons-learned entry linked to the report; finishing without it is rejected.
  - GC3.3 [Enforced] The builder's changes may only touch the paths the report names as affected (factory-managed artifacts are not builder changes and give the builder no exception); anything else is rejected. An extension works as in GB3.2: companion files automatically, otherwise the planner in *re-plan* mode writes a short plan for the report; the human is asked only if another feature's spec or a baseline is affected.
  - GC3.4 [Verified] The hidden bug test fails at its assertion on `main` (GB2.4). [Enforced] Otherwise C3 does not start.
  - GB3.3 and GB3.4 apply unchanged.

### Lessons learned
Purpose: the same mistake never happens twice. `docs/LESSONS-LEARNED.md` is rendered by the factory from structured entries; only the builder adds entries (through a tool, one per Bug), and the human can read it any time.

- **Read:** before every planner run (B2) the factory hands over the active entries whose modules match the modules of the feature (from the architecture and earlier plans); before every builder run (B3, C3) those whose paths or modules match the plan's impact or the report's paths; triage and reviewer get all active entries, so the same cause is noticed in other modules too. Lessons are advice, not instructions (R9): an agent follows a lesson's prevention where it fits the approved spec, architecture, DoD and factory policies, and reports a conflict instead of following it.
- **Review:** ignoring an applicable lesson is a finding with evidence that references the lesson; it is `blocking` only if it also breaks an approved requirement, a mandatory quality rule or another binding decision.
- **Promote:** when a new entry is linked to an earlier one with the same cause (second occurrence), the factory proposes to the human (R2 format) to turn the lesson into a fixed check: a mandatory test or lint rule through a human-authorized gate-policy change (G4.2, G8.2), or a DoD item through a DoD revision (GA5.2). The category Change is used only if the correction also changes a feature spec. Once the check is in force, the entry is `promoted` and no longer handed to agents. *V1: manual – the factory creates no proposal; a promotion is proposed by hand through A6.*
- Guards:
  - GC3.5 [Enforced] The factory hands the lessons to every planner, builder, triage and reviewer run as described above and records which ones. [Verified] The reviewer reports a disregarded applicable lesson.
  - GC3.6 [Verified] The reviewer checks the builder's same-cause link against all earlier lessons and reports a missing or wrong one; the builder is only expected to link lessons it was given, and a link the reviewer confirms is recorded by the factory. The factory rejects links to unknown, later or the entry's own IDs. [Enforced] Once a second occurrence is confirmed by the review, the factory creates the promotion proposal (*V1: manual, see Promote*); only the factory sets `promoted`, after the check is in force.

---

## D. Backlog and prioritization (always)

One ordered list says what the factory works on next. It holds approved features, Changes and Bugs together; the order is the priority. There is no scoring system: in V1 the factory does one entry at a time, so an order is all it needs. The human owns the order, the factory owns everything else in the file. No agent is involved.

### D1 – Backlog entry
`backlog.json` in the project repo root, versioned with the project and readable by agents and the web UI (which shows it; there is no Markdown copy).

- Entry fields: reference (feature ID `F-…` or report ID `BUG-…`; the spec lives in `features/<ID>/`, the report in `bugs/<ID>/`), kind (`feature` / `change` / `bug`), title, short description, status (`open` / `in_progress` / `done` / `discarded`); `done` adds the link to the merged PR, `discarded` a short reason.
- The position in the list is the priority, top first. No priority field and no score; the feature list's MoSCoW priority stays a preliminary classification (A3).
- Template: backlog (JSON Schema).

### D2 – Flow
- **In:** the factory adds entries itself, always at the end: one per feature when the human approves the feature list in A3 (in the feature list's order, `wont` features excluded) and for every feature added later through A6; one per Bug or Change when the human decides the category in triage (C2).
- **Order:** the human moves entries up and down in the web UI. Agents cannot change the order.
- **Next start:** when the entry in progress is `done` (merge in B7), and whenever nothing is in progress, the factory proposes the top `open` entry that can start (a feature needs all its dependencies `done`, GB1.1; an entry that cannot start yet is shown with its reason and skipped). Work starts only after the human releases it: B1 for a feature, C3 for a Bug or Change. The human may first change the order.
- **Out:** a `done` entry stays in the list with the PR link. The human can discard an `open` entry with a short reason; it stays as `discarded`. Discarding a feature removes it from the feature list (A6, status `removed`); discarding a Bug or Change closes its report (a Change's pending spec version is superseded). A feature removed through A6 is discarded here with the revision's reason.
- Entry status follows the factory's state machine: `open` → `in_progress` (released) → `done` (merged); `open` → `discarded`. A B7 rejection keeps the entry `in_progress`.
- *Later:* urgent bugs jumping the queue (hotfix path, part E).

### D3 – Format and guards
- Format: `backlog.json`, validated with JSON Schema; every change is one factory commit to `main` through the merge queue (like GA0.4). The file carries a version; a reorder from the UI is accepted only for the version the UI showed.
- Guards:
  - GD3.1 [Enforced] Only the factory writes `backlog.json`; agents can read it but never write it (run profiles, branch protection, GA0.2).
  - GD3.2 [Enforced] Only the human changes the order, through the web UI.
  - GD3.3 [Verified] Every change is checked against the schema (plus unique references and at most one entry `in_progress`) and committed; an invalid change is rejected.
  - GD3.4 [Enforced] A run for an entry starts only after the human released that entry.

---

## Change log
- 0.6.0 (2026-11-21): Part D specified: one ordered backlog (`backlog.json`) for features, Changes and Bugs; order = priority, changed only by the human in the UI; the factory adds entries at the end (A3, A6, C2) and proposes the top open entry that can start, which runs only after the human's release; done entries keep the PR link, discarded ones a reason; guards GD3.1–GD3.4. B1 now starts from a released backlog entry; Bug and Change wait in the backlog after triage; urgent bugs jumping the queue stay later (part E).
- 0.5.0 (2026-11-21): Version 1 scope section and V1 / Later marks (one feature at a time, only `nextjs-postgres`, own dependencies later, license and accessibility checks by the reviewer, red-before-code/fix recorded only (GB3.1, GC3.1), lesson promotion manual, no `render_preview`, no GitHub mirror, minimal functional web UI, billing modes API and subscription; after the ChatGPT check: A4 exit when an own library is needed, stack-profile gates not run in V1, more Later marks); nothing removed from the concept.
- 0.4.0 (2026-11-21): Self-audit: JSON sources next to their Markdown, closed triage reports via merge queue; file conversion in A1, image files not secret-scanned; GA2.3 only while A2 runs; skeleton modes and version 0.1.0; impact extension with companion files and re-plan (GB3.2, GC3.3); scenario agent runs its tests on main; deterministic builder view (GB4.6); text comparison for review findings (GB5.4); changelog under [Unreleased], version number set at merge; reject with two buttons, comment to the builder; tree hash in GB7.2; visual Change; library: linked report, `waiting`, `await_dependency`, publish on merge; planner lessons by modules; A6 revise baselines (interview and design skills in revision mode, DoR/DoD/gate policy by factory form, affected open features re-confirmed, GA6.1–GA6.2); New feature from triage goes through the interview revision mode; changing done features only through a *supersedes* list approved with the spec (GB1.6), hidden sets of all done features as regression in B4 (GB4.5), project-wide API contract `docs/openapi.yaml`; spec travels with the code on the branch and is released with the merge, other runs read only released specs (G1.5); GA0.4 part-A baselines committed by the factory through the merge queue; revisions from a question carry the spec delta (G2.4); stack profiles defined (`stacks/<id>/`, schema, seed and start commands, test interface, fixed gate commands); GA5.5 test interface in the skeleton; hidden tests use the test interface and a route per screen; B4 gates without Docker socket, with fresh services and commands from the profile; GB4.4 factory judges JUnit results itself. ChatGPT re-audit: version number set before the final gates on the locked integration tree; `gate_config` in the stack profile; rejection before release always revises the spec in B1; attachments outside `briefing/` tracked in the question log; re-plan carries done states over (factory); Change without new criteria skips the scenario agent; regression manifest (GB4.5); local Forgejo registry always allowed; GA4.7 covered by B7 in a library Bug fix; review bound to its merge tree (GB5.2).
- 0.3.2 (2026-11-21): ChatGPT re-check of part C: library bump after the red regression test, B6 factory commit limited to factory-managed files so the review stays valid, reviewer-confirmed same-cause links recorded by the factory, report status authoritative in the factory.
- 0.3.1 (2026-11-21): ChatGPT review of part C worked in: prerequisites checked for the chosen category, Change revision validated like B1, factory assembles the scenario set, factory updates library versions, factory-managed artifacts in the B6 commit, lessons are advice (R9), separate review checks for Bug and Change, triage outcomes, pending spec version, same-cause detection across modules, promotion via gate policy or DoD.
- 0.3.0 (2026-11-21): Part C specified: C1/C2 triage in one attended run (report, reproduction, exactly three categories, human decides), C3 fix in bug or change mode (red regression test, hidden bug test, smallest fix, B2 light for changed criteria), B4–B7 reused, lessons learned read by planner, builder, reviewer and triage and promoted to a fixed check on a second occurrence.
- 0.2.0 (2026-11-21): ChatGPT review and re-check of part B worked in (review modes, scenario-set versions GB2.5, changelog commit before approval, disputed hidden tests go to B2, builder view of gate results, changelog inside the verified merge, valid red baseline, revision invalidates results, SemVer proposal); part B (B1–B7) specified: spec, plan + hidden scenarios, test-first build, gates, independent review, docs + DoD, acceptance; feature statuses; standards named without versions (pinned in the playbook, R10).
- 0.1.2 (2026-11-21): Answers with attachments in A2/A4/A5 (G2.5); GA2.3 exception for attachments; interview log records attachments.
- 0.1.1 (2026-11-20): Pre-commit review: A5 uses the normal PR/review/approval path; attended interviews; precise guards for A1–A4; SemVer by compatibility; standards named precisely; not-applicable artifacts.
- 0.1 (2026-11-20): Part A (A0–A5) specified.
