# Zolo Packing — Storefront Design System

Extracted from the Eco Rewards page (the visual reference) and applied to the
whole customer-facing site. Tokens live in `src/index.css` (`@theme` +
`@utility`); components that compose them live in `src/components/UI.tsx`.
The admin/buyer portals keep their denser ERP system (`erp-*`) but share the
same colours, typography and radii.

## Colour — use intentionally

| Token | Hex | Use |
|---|---|---|
| `green-500` (brand) | #15803d | brand, eco messaging, success, **selected state**, nav active, links |
| `green-600/700/800` | #166534 / #0b4a2b / #0d3f26 | hover, dark green bands |
| `green-50/100/200` | #f5faf6 / #eef8f1 / #d3efdb | mint section backgrounds, image stages, selected chips |
| `primary-500` (orange) | #f97316 | **conversion CTA only**: Get Quote, Buy Now, Add to Cart, Checkout |
| `navy-900/950` | #0f172a / #020817 | footer, dark bands, summary panels |
| `cream-50/100` | #fcfaf2 / #fff8e8 | supporting section backgrounds |
| `dark-900` | #0f172a | primary text |
| `dark-500` | #64748b | secondary text |
| `dark-200` | #e2e8f0 | borders |
| white | | product cards, forms, main content |

Never: gradients on text (`grad-text`), cyan/`accent-*`, `emerald-*`/`ink-*`/`brand-*` aliases, orange as a background for anything that is not a CTA.

## Typography (Inter body, Plus Jakarta Sans display)

| Class | Desktop | Mobile | Weight |
|---|---|---|---|
| `h1` | 48px | 32px | 800 |
| `h2` | 36px | 26px | 700 |
| `h3` | 22px | 20px | 700 |
| `lead` | 17px | 15px | 400, dark-600 |
| body | 15–16px | 14–15px | 400 |
| small | 12–13px | | 500 |
| `eyebrow` | 12px uppercase, tracking .18em, green | | 700 |

Line-height ≤ 1.6. Weight 800 only on the H1 / hero.

## Spacing & container

* Scale: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64 / 80.
* `.shell` = the ONE container: max 1320px, gutter 16px → 32px. Header, hero,
  grids, PDP, cart, quote, footer all align on it.
* `.section` = 40px / 48px vertical padding. `.section-sm` = 32px / 40px. No `py-16`/`py-20`/`py-24`.
* Card padding 16–24px. Small gaps 8–12, normal 16–24, section gaps 40–64.
* Heading → content: 16–24px. Hero: 40–64px max.

## Surfaces

* `.card` — white, 1px `dark-200` border, 12px radius, `shadow-card`. `.card-hover` adds a 3px lift + `shadow-card-hover` (200ms).
* `.card-flat` — same without shadow (grids, list rows).
* Dark panels: `bg-navy-900` / `bg-green-800`, `rounded-[12px]`.
* No `rounded-3xl`, no heavy shadows, no `glass`.

## Buttons (`btn` + variant; 44px / 8px radius / 15px bold; `btn-sm` 38px, `btn-lg` 48px)

| Variant | Use |
|---|---|
| `btn-primary` (orange) | the ONE conversion action on a screen |
| `btn-secondary` (white, green border/text) | secondary action next to a primary |
| `btn-green` | eco / positive confirmations |
| `btn-navy` | dark panels, "Buy now" beside "Add to cart" |
| `btn-outline` (neutral) | tertiary |
| `btn-ghost` | inline / toolbar |

Use `<Button>` / `<ButtonLink>` / `buttonClass()` from `components/UI.tsx`.

## Forms

`<Field label … error>` + `<Input>` / `<Select>` / `<Textarea>` (44px, 10px radius, green focus ring, error text under the field). Labels always visible; placeholders never replace labels.

## Chips, badges, breadcrumbs, empty & error states

`chip` / `chip-active` (green), `<Badge tone>`, `<Breadcrumb items>`, `<EmptyState icon title message action>`, `<ErrorState onRetry>`, `<ProductCardSkeleton>` / `<SkeletonGrid>`.

## Product card (`components/NewProductCard.tsx`)

Fixed 4:3 image stage on `green-50` (object-contain, never cropped) → spec tag + MOQ → 2-line name (reserved height) → sizes/colours lines (reserved height, only when present) → price row → CTA row pinned to the bottom. Grid: `.grid-cards` (2 → 4 columns).

## Motion

Framer Motion, fast and subtle: cards 200ms lift, buttons 150ms, dropdowns 150ms, modals 200–250ms, sections fade 10px/350ms. No bouncing, parallax or slow reveals.
