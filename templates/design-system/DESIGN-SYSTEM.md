# Design system – {project name}

<!-- Human-readable companion to docs/design-tokens.tokens.json (DTCG Format Module 2025.10).
     The token file is the source of truth for values; this document explains intent and usage.
     Accessibility target comes from approved PRD section 8. If the PRD sets none, the design agent recommends one (e.g. WCAG 2.2 AA) and asks the human; it is never assumed silently. If the product has no UI, this file is not created (not applicable). -->

| Field | Value |
|---|---|
| Baseline version | {set by the factory (GA4.3)} |
| Token file | `docs/design-tokens.tokens.json` |
| Themes | {light \| dark \| both} |

## 1 Look and feel
{Three to five adjectives and one paragraph on the intended feel.}

**References used:** {briefing files tagged design-reference, with what was taken from each.}

## 2 Foundations
| Foundation | Tokens | Usage rule |
|---|---|---|
| Color roles | `color.*` | {e.g. primary for one main action per screen; text/background pairs meet contrast target} |
| Typography | `font.*`, `typography.*` | {scale, where each level is used} |
| Spacing | `space.*` | {base unit and scale} |
| Radius | `radius.*` | {…} |
| Elevation | `shadow.*` | {…} |
| Motion | `duration.*`, `easing.*` | {…; respect reduced motion} |

## 3 Core components
| Component | Variants | States | Notes |
|---|---|---|---|
| Button | {primary, secondary, …} | default, hover, focus, active, disabled, loading | {…} |
| {Input} | {…} | default, focus, error, disabled | {…} |

## 4 Layout and responsiveness
{Breakpoints, grid, minimum phone width (e.g. 375 px).}

## 5 Accessibility
{Contrast target, focus visibility, minimum touch target, keyboard use.}
