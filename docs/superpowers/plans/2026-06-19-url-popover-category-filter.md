# UrlPopover Category Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact category-filter dropdown to `UrlPopover` so users can narrow the link list by SSH / tag / uncategorized without adding height to the popover.

**Architecture:** New `tagOptions` prop activates a flex row in the sticky search header (search input + select). A `selectedCategory` state feeds a category pre-filter that runs before the existing fuzzy-search filter. When `tagOptions` is absent or empty, nothing changes — the component is fully backwards-compatible.

**Tech Stack:** React (useState, useMemo), TypeScript, Tailwind/CSS vars, native `<select>`.

## Global Constraints

- No new npm dependencies.
- Do not modify `DetailDocumentationCard` or `docLinkTagOptions` management logic.
- `tagOptions` prop is optional; default behaviour must be identical to today.
- Both English and Chinese i18n strings must be added in the same edit.
- Do not run `npm install` or `npm run build` from WSL on `/mnt/d/` paths.

---

### Task 1: i18n keys

**Files:**
- Modify: `src/core/renderer/i18n/messages.ts:49` (EN, after `noMatches`)
- Modify: `src/core/renderer/i18n/messages.ts:1134` (ZH, after `noMatches`)

**Interfaces:**
- Produces: `t('common.allCategories')` → `'All'` / `'全部'`
- Produces: `t('common.sshConnections')` → `'SSH connections'` / `'SSH 连接'`
- `t('common.uncategorized')` already exists — no change needed.

- [ ] **Step 1: Insert EN keys after line 49 (`noMatches`)**

In `messages.ts`, after `noMatches: 'No matches',` (line 49), insert:
```ts
      allCategories: 'All',
      sshConnections: 'SSH connections',
```

- [ ] **Step 2: Insert ZH keys after line 1134 (`noMatches` ZH)**

After `noMatches: '没有匹配项',` (line 1134), insert:
```ts
      allCategories: '全部',
      sshConnections: 'SSH 连接',
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /mnt/d/tools/ide-electron && npx tsc --noEmit 2>&1 | head -20
```
Expected: zero errors related to i18n keys (type system will catch missing keys immediately).

- [ ] **Step 4: Commit**

```bash
git add src/core/renderer/i18n/messages.ts
git commit -m "feat: add allCategories and sshConnections i18n keys"
```

---

### Task 2: UrlPopover — category state + filter logic + UI

**Files:**
- Modify: `src/core/renderer/components/UrlPopover.tsx`

**Interfaces:**
- Consumes: `t('common.allCategories')`, `t('common.sshConnections')`, `t('common.uncategorized')` from Task 1.
- Produces: updated `UrlPopoverProps` with `tagOptions?: ReadonlyArray<{ value: string; label: string }>`.

- [ ] **Step 1: Add `tagOptions` to `UrlPopoverProps` interface (line 7–22)**

Replace:
```ts
interface UrlPopoverProps {
  urls?: string[]
  items?: {
    url: string
    label: string
    tag?: string
    tagLabel?: string
    onOpen?: () => void | Promise<void>
    kind?: 'url' | 'ssh'
    description?: string
    copyValue?: string
    copyLabel?: string
    copyValueResolver?: () => Promise<string>
  }[]
  children: React.ReactNode
}
```
With:
```ts
interface UrlPopoverProps {
  urls?: string[]
  items?: {
    url: string
    label: string
    tag?: string
    tagLabel?: string
    onOpen?: () => void | Promise<void>
    kind?: 'url' | 'ssh'
    description?: string
    copyValue?: string
    copyLabel?: string
    copyValueResolver?: () => Promise<string>
  }[]
  tagOptions?: ReadonlyArray<{ value: string; label: string }>
  children: React.ReactNode
}
```

- [ ] **Step 2: Destructure `tagOptions` in the component signature (line 57)**

Replace:
```ts
export function UrlPopover({ urls, items, children }: UrlPopoverProps) {
```
With:
```ts
export function UrlPopover({ urls, items, tagOptions, children }: UrlPopoverProps) {
```

- [ ] **Step 3: Add `selectedCategory` state after `query` state (line 63)**

After:
```ts
  const [query, setQuery] = useState('')
```
Add:
```ts
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
```

- [ ] **Step 4: Add derived category values after `hasPopover` (line 98)**

After:
```ts
  const hasPopover = preparedEntries.length > 1
```
Add:
```ts
  const showCategorySelect = Boolean(tagOptions && tagOptions.length > 0)
  const hasSshEntries = preparedEntries.some((e) => e.kind === 'ssh')
  const hasTagEntries = preparedEntries.some((e) => e.tag)
  const hasUncategorized = hasTagEntries && preparedEntries.some((e) => !e.tag)
```

- [ ] **Step 5: Add `categoryFilteredEntries` memo before `normalizedQuery` (line 99)**

After the four derived values added in Step 4, add:
```ts
  const categoryFilteredEntries = useMemo(() => {
    if (selectedCategory === 'all') return preparedEntries
    if (selectedCategory === 'ssh') return preparedEntries.filter((e) => e.kind === 'ssh')
    if (selectedCategory === 'uncategorized') return preparedEntries.filter((e) => !e.tag)
    return preparedEntries.filter((e) => e.tag === selectedCategory)
  }, [selectedCategory, preparedEntries])
```

- [ ] **Step 6: Update `filteredEntries` to use `categoryFilteredEntries`**

Replace:
```ts
  const filteredEntries = useMemo(() => {
    if (!deferredQuery) return preparedEntries

    return preparedEntries.filter((entry) => {
```
With:
```ts
  const filteredEntries = useMemo(() => {
    if (!deferredQuery) return categoryFilteredEntries

    return categoryFilteredEntries.filter((entry) => {
```
(Only the two `preparedEntries` references inside this memo change; the filter body stays identical.)

- [ ] **Step 7: Reset `selectedCategory` on popover close**

In the `useEffect([show])` block, find:
```ts
  useEffect(() => {
    if (!show) {
      setQuery('')
      setCopiedKey(null)
      return
    }
```
Replace with:
```ts
  useEffect(() => {
    if (!show) {
      setQuery('')
      setCopiedKey(null)
      setSelectedCategory('all')
      return
    }
```

- [ ] **Step 8: Update the sticky search header to add the category select**

Replace the entire sticky header div (lines 287–306):
```tsx
      <div className="sticky top-0 z-[1] px-1.5 pb-2">
        <input
          ref={searchInputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            focusWithinRef.current = true
            clearHideTimer()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              setQuery('')
            }
          }}
          placeholder={t('common.searchLinks')}
          className="quiet-control h-8 w-full rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)]"
        />
      </div>
```
With:
```tsx
      <div className="sticky top-0 z-[1] px-1.5 pb-2">
        <div className={showCategorySelect ? 'flex items-center gap-1.5' : undefined}>
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              focusWithinRef.current = true
              clearHideTimer()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setQuery('')
              }
            }}
            placeholder={t('common.searchLinks')}
            className={`quiet-control h-8 rounded-full border-0 px-3 text-xs text-[color:var(--color-foreground)] placeholder:text-[color:var(--color-muted-foreground)]${showCategorySelect ? ' min-w-0 flex-1' : ' w-full'}`}
          />
          {showCategorySelect && (
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="quiet-control h-8 shrink-0 cursor-pointer rounded-full border-0 px-2 text-xs text-[color:var(--color-foreground)]"
            >
              <option value="all">{t('common.allCategories')}</option>
              {hasSshEntries && (
                <>
                  <option disabled>──────────</option>
                  <option value="ssh">{t('common.sshConnections')}</option>
                </>
              )}
              {hasTagEntries && (
                <>
                  <option disabled>──────────</option>
                  {hasUncategorized && (
                    <option value="uncategorized">{t('common.uncategorized')}</option>
                  )}
                  {tagOptions!.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </>
              )}
            </select>
          )}
        </div>
      </div>
```

- [ ] **Step 9: Verify TypeScript**

```bash
cd /mnt/d/tools/ide-electron && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/core/renderer/components/UrlPopover.tsx
git commit -m "feat: add category filter to UrlPopover"
```

---

### Task 3: ProjectCard — wire tagOptions prop

**Files:**
- Modify: `src/core/renderer/components/ProjectCard.tsx:408`

**Interfaces:**
- Consumes: `tagOptions` prop from Task 2.
- Consumes: `docLinkTagOptions` (already in scope at line 45 as `s.config.docLinkTags`).

- [ ] **Step 1: Pass `docLinkTagOptions` to `UrlPopover`**

In `ProjectCard.tsx`, replace:
```tsx
          <UrlPopover items={linkMenuItems}>
```
With:
```tsx
          <UrlPopover items={linkMenuItems} tagOptions={docLinkTagOptions}>
```

`docLinkTagOptions` is typed as `ProjectDocTagOption[]` (`{ value, label, sortOrder }[]`), which is structurally assignable to `ReadonlyArray<{ value: string; label: string }>` — no cast needed.

- [ ] **Step 2: Verify TypeScript**

```bash
cd /mnt/d/tools/ide-electron && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/renderer/components/ProjectCard.tsx
git commit -m "feat: pass docLinkTagOptions to UrlPopover for category filter"
```
