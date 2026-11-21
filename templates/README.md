# Levuvo SF templates – parts A, B and C

Versioned templates and schemas (R10, G10.2). Markdown templates are filled by the factory or the human; JSON schemas (JSON Schema 2020-12) check the structure of machine-readable artifacts; the factory additionally enforces cross-field consistency, references, approvals and domain standards (purl, SemVer, DTCG, OpenAPI). Placeholders: `{…}`. Pinned standard versions: see the standards table in the playbook (R10).

| Template | Step | Format | Based on |
|---|---|---|---|
| [briefing/BRIEFING.md](briefing/BRIEFING.md) | A1 | Markdown, optional | – |
| [briefing/inventory.schema.json](briefing/inventory.schema.json) | A1 | JSON Schema | IANA media types, SHA-256 |
| [question/question-answer.schema.json](question/question-answer.schema.json) | all (R2, G2.5) | JSON Schema | R2 format |
| [interview/interview-log.schema.json](interview/interview-log.schema.json) | all (question log) | JSON Schema | reuses question-answer |
| [prd/PRD.md](prd/PRD.md) | A3 | Markdown | common PRD sections, ISO/IEC/IEEE 29148:2018 principles |
| [features/features.schema.json](features/features.schema.json) | A3, B | JSON Schema → FEATURES.md | MoSCoW |
| [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) | A4 | Markdown | arc42 (lite), C4 model, Mermaid |
| [adr/NNNN-title.md](adr/NNNN-title.md) | A4 | Markdown | MADR 4.0 |
| [design-system/DESIGN-SYSTEM.md](design-system/DESIGN-SYSTEM.md) | A4 | Markdown | WCAG 2.2 |
| [design-system/design-tokens.schema.json](design-system/design-tokens.schema.json) | A4 | JSON Schema (structural) | DTCG Format Module 2025.10 (preliminary check) |
| [dependencies/dependencies.schema.json](dependencies/dependencies.schema.json) | A4 (*Later*) | JSON Schema | Package URL (ECMA-427), SemVer 2.0.0 |
| [dor-dod/checklist.schema.json](dor-dod/checklist.schema.json) | A5 | JSON Schema | stack profile, human-approved DoR/DoD; gate results as JUnit XML / SARIF |
| [stack-profile/profile.schema.json](stack-profile/profile.schema.json) | A4, A5, B2, B4 | JSON Schema (factory configuration in `stacks/<id>/`) | stack profile: commands, services, gates, test interface |
| [spec/spec.schema.json](spec/spec.schema.json) + [spec/SPEC.md](spec/SPEC.md) | B1 | JSON Schema → Markdown | user stories, EARS, Gherkin, ISO/IEC/IEEE 29148 |
| [plan/plan.schema.json](plan/plan.schema.json) + [plan/PLAN.md](plan/PLAN.md) | B2 | JSON Schema → Markdown | task checklist |
| [scenarios/scenarios.schema.json](scenarios/scenarios.schema.json) | B2 | JSON Schema (factory store) | test → AC mapping |
| [build-report/build-report.schema.json](build-report/build-report.schema.json) | B3 | JSON Schema | BCP 47 |
| [gate-report/gate-report.schema.json](gate-report/gate-report.schema.json) | B4 | JSON Schema | JUnit XML, SARIF inputs |
| [review/review-report.schema.json](review/review-report.schema.json) | B5 | JSON Schema | severities map to SARIF levels |
| [acceptance/ACCEPTANCE.md](acceptance/ACCEPTANCE.md) | B7 | Markdown, generated | R6 |
| [changelog/CHANGELOG.md](changelog/CHANGELOG.md) | B6, B7 | Markdown, factory-written | Keep a Changelog, SemVer, Conventional Commits |
| [bugs/report.schema.json](bugs/report.schema.json) + [bugs/REPORT.md](bugs/REPORT.md) | C1/C2, C3 | JSON Schema → Markdown (`bugs/<ID>/`) | IEEE 1044 attributes |
| [lessons-learned/lessons-learned.schema.json](lessons-learned/lessons-learned.schema.json) + [lessons-learned/LESSONS-LEARNED.md](lessons-learned/LESSONS-LEARNED.md) | C3, B2, B3, B5 | JSON Schema → Markdown (`docs/`) | – |

Not templated here: `.devcontainer/devcontainer.json` follows the Dev Container specification and `features/<ID>/openapi.yaml` the OpenAPI specification directly; in part C, build, gate and review reports carry the optional `report_id` and the scenario manifest marks bug tests with `bug`; hidden tests use the stack profile's test framework (Gherkin where supported); input schemas of the factory tools are defined with the tools.

Schema tests: `python3 templates/tests/test_schemas.py` (valid and invalid examples for every schema, incl. the stack profile in `stacks/`; needs the `jsonschema` package, run inside a container).
