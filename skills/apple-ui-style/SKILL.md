---
name: apple-ui-style
description: Project UI style guide for this Electron React renderer. Use when adding, changing, or reviewing UI in src/renderer, including pages, components, global CSS, Tailwind classes, dialogs, cards, menus, settings, runtime views, and new feature screens, so visual design remains quiet, warm, spacious, low-contrast, and Apple-like.
---

# Apple UI Style

Use this skill whenever UI files under `src/renderer` are touched. The goal is not to copy Apple assets; the goal is to preserve the product emotion: quiet, warm, spacious, restrained, and content-first.

## Core Direction

Build UI that lowers the interface presence.

- Put content, state, and user task above decoration.
- Prefer warm neutral surfaces over pure white, pure black, or pure gray.
- Use blue as an action cue, not a background theme.
- Make borders nearly invisible; use material separation, spacing, and subtle contrast first.
- Use large whitespace and soft grouping before adding more controls.
- Keep typography light: prefer `400`, `500`, `600`; avoid `700+` except rare hero emphasis.
- Keep shadows barely perceptible; cards should feel like material, not floating panels.

## Design Tokens

Prefer existing tokens in `src/renderer/styles/global.css`.

- Background: `#f5f5f7` light, `#1c1c1e` dark.
- Foreground: `#1d1d1f` light, `#f5f5f7` dark.
- Primary: `#0a84ff`, used sparingly for primary actions and active state.
- Muted text: `#6e6e73` light, `#a1a1a6` dark.
- Surfaces: use `var(--color-card)` with `surface-card`.
- Controls: use `quiet-control` for inputs, secondary buttons, filters, and low-priority action chips.
- Page chrome: use `app-chrome` for top bars.
- Section captions: use `section-label`.
- Spacious page body: use `content-breathe` for main index/list pages.

Do not introduce new one-off hardcoded blues, grays, black, white, or strong gradients unless the existing token set cannot solve the case.

## Layout Rules

Use spacing to create air.

- Page top bars should be around `min-h-[76px]` to `min-h-[84px]`.
- Main content should use `px-8`, `py-8` or larger on desktop.
- Use `gap-5`, `gap-6`, `gap-8`, `space-y-7`, `space-y-10` for major structure.
- Cards should commonly use `rounded-[22px]`, `rounded-[24px]`, or `rounded-[28px]`.
- Controls should generally be pills: `rounded-full`.
- Prefer max widths like `max-w-3xl` for focused settings/forms and `content-breathe` for lists.
- On narrow windows, add or preserve responsive padding; do not hard-code desktop-only width assumptions.

## Component Patterns

### Top Bars

Use:

```tsx
<header className="app-chrome flex min-h-[84px] items-center px-8 py-4">
```

Back/settings icon buttons:

```tsx
className="rounded-full p-2 text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
```

### Inputs

Use `Input` or native input with:

```tsx
className="quiet-control h-11 rounded-full border-0 px-4"
```

Avoid visible hard borders unless required for validation/error states.

### Cards

Use:

```tsx
className="rounded-[24px] border surface-card"
style={{ borderColor: 'var(--color-border)' }}
```

Use hover sparingly with `surface-card-hover`; hover lift should be small and slow.

### Secondary Actions

Use `quiet-control` and muted text:

```tsx
className="quiet-control rounded-full px-4 py-2 text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)] hover:text-[color:var(--color-foreground)]"
```

### Primary Actions

Use primary blue only for the main action on a surface:

```tsx
className="rounded-full bg-primary text-white hover:bg-primary-hover shadow-sm"
```

Avoid multiple strong blue buttons in the same visual group.

### Status

Use status tokens, not Tailwind raw colors:

- Success: `var(--color-success)`, `var(--color-success-background)`.
- Warning: `var(--color-warning)`, `var(--color-warning-background)`.
- Destructive: `var(--color-destructive)`, `var(--color-destructive-background)`.

## What To Avoid

- Avoid purple-by-default aesthetics.
- Avoid pure `#fff`, `#000`, hard `gray-*`, `blue-*`, `red-*`, `amber-*`, `emerald-*` Tailwind color classes in UI surfaces.
- Avoid heavy shadows such as `0 20px 60px` unless it is a popover/modal and uses `var(--shadow-popover)`.
- Avoid dense rows with `py-2` for primary content cards.
- Avoid strong gradients, strong borders, and high-saturation backgrounds.
- Avoid “AI tool dashboard” visual noise: too many badges, outlines, dividers, and high-contrast hover states.
- Do not add external web fonts for the main UI. Use system Apple-like stack from `global.css`; keep JetBrains Mono only for terminal/code if already present.

## Workflow For New UI Work

1. Read nearby existing renderer files before editing.
2. Reuse `global.css` tokens and helper classes first.
3. Match the current Apple-like patterns in `Home.tsx`, `ProjectCard.tsx`, `Detail.tsx`, `RuntimePage.tsx`, and `Settings.tsx`.
4. Keep business logic untouched unless the user asks for behavior changes.
5. Prefer `apply_patch` for focused source edits.
6. Validate with `npm run typecheck` only if dependencies are already present.
7. Do not run `npm i`, `npm install`, or Linux-side package installation for this repo unless the user explicitly asks. This project is Windows-hosted, and Linux-installed optional native packages can break Windows usage.
8. If build fails because of a missing Rollup/Vite optional native dependency in Linux `node_modules`, report it and ask the user to run the install/build on Windows instead of repairing it from Linux.

## Review Checklist

Before finishing UI work, check:

- Are colors token-based and warm/neutral?
- Is blue limited to actual actions or active state?
- Are cards/controls soft and rounded enough?
- Are borders subtle or replaced by material separation?
- Is spacing large enough for breathing room?
- Is text weight mostly `400-600`?
- Does the UI still work in light and dark themes?
- Did you avoid Linux-side dependency installation?
