# Levuvo SF templates – part A

Versioned templates and schemas (R10, G10.2). Markdown templates are filled by the factory or the human; JSON schemas (JSON Schema 2020-12) check the structure of machine-readable artifacts; the factory additionally enforces cross-field consistency, references, approvals and domain standards (purl, SemVer, DTCG). Placeholders: `{…}`.

| Template | Step | Format | Based on |
|---|---|---|---|
| [briefing/BRIEFING.md](briefing/BRIEFING.md) | A1 | Markdown, optional | – |
| [briefing/inventory.schema.json](briefing/inventory.schema.json) | A1 | JSON Schema | IANA media types, SHA-256 |
| [question/question-answer.schema.json](question/question-answer.schema.json) | all (R2, G2.5) | JSON Schema | R2 format |
| [interview/interview-log.schema.json](interview/interview-log.schema.json) | A2, A4 | JSON Schema | reuses question-answer |
| [prd/PRD.md](prd/PRD.md) | A3 | Markdown | common PRD sections, ISO/IEC/IEEE 29148:2018 principles |
| [features/features.schema.json](features/features.schema.json) | A3 | JSON Schema → FEATURES.md | MoSCoW |
| [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) | A4 | Markdown | arc42 (lite), C4 model, Mermaid |
| [adr/NNNN-title.md](adr/NNNN-title.md) | A4 | Markdown | MADR 4.0 |
| [design-system/DESIGN-SYSTEM.md](design-system/DESIGN-SYSTEM.md) | A4 | Markdown | WCAG 2.2 |
| [design-system/design-tokens.schema.json](design-system/design-tokens.schema.json) | A4 | JSON Schema (structural) | DTCG Format Module 2025.10 (preliminary check) |
| [dependencies/dependencies.schema.json](dependencies/dependencies.schema.json) | A4 | JSON Schema | Package URL (ECMA-427), SemVer 2.0.0 |
| [dor-dod/checklist.schema.json](dor-dod/checklist.schema.json) | A5 | JSON Schema | stack profile, human-approved DoR/DoD; gate results as JUnit XML / SARIF |

Not templated here: `.devcontainer/devcontainer.json` follows the Dev Container specification directly; input schemas of the factory tools are defined with the tools.
