# Spec {F-NNN} – {feature name}

| Field | Value |
|---|---|
| Spec version | {set by the factory (GB1.3)} |
| Approval | {draft \| approved on YYYY-MM-DD by {human}} |
| Based on | PRD {version} · Architecture {version} · Design system {version \| not applicable} · DoR {version} |

<!-- Rendered by the factory from structured spec output (spec.schema.json). Approved specs are read-only (G1.1);
     a change is a new version (G1.3). Requirements follow ISO/IEC/IEEE 29148 characteristics (necessary,
     unambiguous, verifiable, consistent) and are written as EARS sentences with exactly one "shall".
     Every acceptance criterion is checkable by an automated test; what only a human can judge belongs to the DoD.
     Given/When/Then here is a readable excerpt; executable .feature files use the full Feature/Scenario structure. -->

## 1 User stories
- As a {user group}, I want {goal}, so that {benefit}. *Source: {source}*

## 2 Requirements and acceptance criteria

### REQ-{NNN}-01 – {short title}
**{EARS sentence, e.g. "When the user submits the form, the system shall save the booking."}** *Source: {source}*

- **AC-{NNN}-01** – {pass/fail statement}
- **AC-{NNN}-02**
  ```gherkin
  Given {context}
  When {action}
  Then {observable result}
  ```

## 3 Interface contract
<!-- Only for API features; otherwise "Not applicable." -->
{`features/{F-NNN}/openapi.yaml` (OpenAPI) – endpoints added or changed by this feature.}

## 4 UI reference
<!-- Only if a design system applies; otherwise "Not applicable." -->
| Screen | What the user sees and does | Components (DESIGN-SYSTEM.md) |
|---|---|---|
| {screen} | {description incl. visible labels the ACs rely on} | {components} |

## 5 Out of scope
- {What this feature deliberately does not do.}

## 6 Open questions
- {question} – {blocking \| non-blocking, accepted by the human}
