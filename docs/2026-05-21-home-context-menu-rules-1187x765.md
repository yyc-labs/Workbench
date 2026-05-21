# Home Context Menu Rules (1187x765 Baseline)

Date: 2026-05-21
Scope: `src/renderer/components/ProjectCard.tsx`, `src/renderer/components/CardContextMenu.tsx`

## Objective
The Home page interaction baseline is a viewport around `1187 x 765`.
All context-menu behavior and visual decisions for project cards must be optimized for this baseline first.

## Non-negotiable Constraints
1. The project-card context menu must never overflow outside the viewport.
2. In `1187 x 765`, all primary entry points must be visible without layout break:
   - Open folder
   - Open in terminal
   - Open in VS Code
3. Avoid adding noisy card metadata in the menu header.
   - Do not display project name/path in the menu header by default.
4. Keep the card body visually stable.
   - No hover-reveal quick action blocks on the card itself.

## Layout Rules
1. Menu width should stay in the practical range `260px` to `324px`.
2. Menu position must be clamped with viewport padding (`8px` minimum).
3. Menu height must support constrained viewports:
   - `max-height = viewport height - 16px`
   - Enable vertical scrolling when content is taller than available height.
4. Top area should remain lightweight:
   - Runtime/Dev status chips are allowed.
   - Do not inject long explanatory text into the menu UI.

## Information Architecture Rules
1. Keep the three high-frequency open actions in a dedicated top action block.
2. Keep remaining actions grouped and separated:
   - Runtime
   - Project
   - Preference
   - Management (danger actions)
3. Danger actions must use destructive tone and be visually isolated from neutral actions.

## Interaction Rules
1. Right-click opens menu at pointer position, then applies viewport-safe correction.
2. Click outside and `Esc` must close the menu.
3. While the menu is open, internal pointer events must not bubble and accidentally close it.

## Acceptance Checklist (1187x765)
1. Right-click near each corner keeps the menu fully visible.
2. No clipping on the right or bottom edges.
3. The 3-entry quick-open block remains readable and clickable.
4. Menu remains usable when action count grows (scrolling available).
5. No project name/path header appears in the current menu design.

## Change Control
If future UI updates conflict with these rules, prioritize viewport safety and operational clarity over decorative content.
