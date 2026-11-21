# {BUG-NNN} – {title}

| Field | Value |
|---|---|
| Status | {triage \| decided \| in_progress \| in_acceptance \| done \| closed ({reason})} – state at the last factory commit; the factory shows the current status |
| Reported | {YYYY-MM-DD HH:MM} |
| Category | {proposed: Bug \| Change \| New feature} · {decided by the human on YYYY-MM-DD \| open} |
| Affects | {F-NNN} spec v{n} · {AC-NNN-nn, …} · {modules} |
| Fix | {branch} · {PR} · {released in x.y.z} · lesson {LL-NNN} |

<!-- Rendered by the factory from report.json (report.schema.json); fields follow IEEE 1044 anomaly attributes.
     Stored in the project repo under bugs/{BUG-NNN}/ with attachments/. The original message is stored unchanged by the
     factory (GC1.1); the triage agent fills sections 2–6 through tools and has no write access to code (GC1.4).
     A Bug must name the AC it violates (GC1.3); paths under "Affects" are the fix impact (GC3.3). -->

## 1 Original message
> {The human's words, unchanged, in their language.}

Attachments: {bugs/BUG-NNN/attachments/… \| none}

## 2 Steps to reproduce
1. {step}

## 3 Expected vs actual
- **Expected:** {what should happen, with the AC if one exists}
- **Actual:** {what happens}

## 4 Environment
{version or commit · device · OS · browser · notes}

## 5 Reproduction
{reproduced \| not reproduced \| works as specified} on `main` `{short hash}`.
{What the agent did and saw: commands, output, screenshot path.}

## 6 Classification
**Proposal: {Bug \| Change \| New feature}** – {reason in one or two sentences}.
{Duplicate of {BUG-NNN} – linked by the factory.}

Change only – spec delta:
| Op | Target | New text |
|---|---|---|
| {add \| modify \| remove} | {AC-NNN-nn \| REQ-NNN-nn} | {statement} |

## 7 Decision
{Category chosen by the human, date, comment. Change: new spec version v{n}. New feature: added as {F-NNN}.}
