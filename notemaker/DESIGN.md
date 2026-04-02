# Design System Strategy: High-End Productivity Editorial

## 1. Overview & Creative North Star
The "Creative North Star" for this design system is **"The Architectural Curator."** 

Unlike standard enterprise dashboards that rely on heavy borders and rigid, claustrophobic grids, this system treats the interface as a spacious, high-end gallery. It is designed to feel intentional, quiet, and premium. We move beyond the "template" look by utilizing significant white space, asymmetrical layouts, and depth created through tonal shifts rather than structural lines. The goal is to make the user feel like they are interacting with a curated workspace where the AI does the heavy lifting, reflected in a UI that feels light and effortless.

---

## 2. Colors & Surface Philosophy

The palette is rooted in soft neutrals and sophisticated accents, avoiding high-contrast "gamer" aesthetics in favor of a workspace that breathes.

### Palette Highlights
- **Base Surface:** `#f8f9fa` (Surface) provides a crisp, professional canvas.
- **The Accents:** `primary` (#4d44e3) and `secondary` (#506076) are used sparingly for high-intent actions and semantic signaling.
- **The "No-Line" Rule:** We explicitly prohibit 1px solid borders for sectioning. Boundaries must be defined solely through background color shifts or subtle tonal transitions. A sidebar sitting on `surface` should be `surface-container-low` (#f1f4f6), creating a natural break without a hard stroke.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers—like stacked sheets of fine paper.
- **Layer 1 (Background):** `surface` (#f8f9fa)
- **Layer 2 (Sectioning):** `surface-container-low` (#f1f4f6) or `surface-container` (#eaeff1)
- **Layer 3 (Active Cards):** `surface-container-lowest` (#ffffff)
This "nesting" creates depth through luminance rather than shadow.

### The "Glass & Gradient" Rule
Floating elements (modals, dropdowns) should utilize **Glassmorphism**. Use `surface` colors at 80% opacity with a `20px` backdrop-blur. For primary CTAs, apply a signature texture: a subtle linear gradient from `primary` (#4d44e3) to `primary-dim` (#4034d7) to provide a "soul" that flat hex codes lack.

---

## 3. Typography: Editorial Authority

We use a dual-typeface system to balance character with utility.

- **Display & Headlines (Manrope):** Bold, geometric, and authoritative. The `display-lg` (3.5rem) and `headline` tiers are used to create a clear "Editorial" feel, making the software feel like a published report.
- **Body & Labels (Inter):** Highly legible and neutral. `body-md` (0.875rem) is the workhorse for productivity, ensuring long-form AI responses are easy to parse.
- **Hierarchy through Scale:** Use extreme scale differences. A `display-sm` title paired with a `label-sm` metadata tag creates a sophisticated, modern contrast that feels bespoke.

---

## 4. Elevation & Depth: Tonal Layering

Traditional shadows are often a crutch for poor layout. We achieve hierarchy primarily through **Tonal Layering**.

- **The Layering Principle:** Place a `surface-container-lowest` (pure white) card on a `surface-container-low` section. The change in lightness provides a soft, natural lift.
- **Ambient Shadows:** When a floating effect is required (e.g., a "Research" button or a floating LLM status bar), use extra-diffused shadows:
    - **Shadow:** `0px 12px 32px rgba(43, 52, 55, 0.06)`
    - This tinted, low-opacity shadow mimics natural light rather than a digital "drop shadow."
- **The "Ghost Border" Fallback:** If a border is required for accessibility, use the `outline-variant` token at 15% opacity. Never use 100% opaque, high-contrast strokes.
- **Integrated Glass:** Elements like the LLM status indicator in the top header should feel integrated. Use semi-transparent backgrounds to let the page content "bleed" through, softening the edges of the UI.

---

## 5. Components

### Buttons
- **Primary:** `primary` gradient background with `on-primary` text. Roundedness: `lg` (1rem).
- **Secondary:** `surface-container-high` background with `on-surface` text. No border.
- **Hover States:** A subtle shift in `surface-tint` or a light elevation increase (ambient shadow). Avoid aggressive color flashes.

### Input Fields
- **Minimalist Input:** Transparent background with an `outline-variant` at 20% opacity. Upon focus, the bottom border "glows" with the `primary` color.
- **Cards:** Forbid divider lines. Use vertical white space (`spacing-6`) or subtle background shifts between sections. Radius: `lg` (1rem) for standard cards; `xl` (1.5rem) for major containers.

### Navigation & Layout
- **Sidebar:** Collapsible, using `surface-container-low`. Icons should be `1.5pt` thin-stroke variants.
- **LLM Status Indicator:** A pill-shaped component (`rounded-full`) using `surface-container-highest` with a small glowing pulse indicator in the `tertiary-fixed` color.

### Custom Component: The "Agent Brain" Chip
A compact, `rounded-md` (0.75rem) chip used in the sidebar to show AI sub-processes. Background: `surface-container-highest`. Text: `label-sm`. These should appear as a "stack" to show multi-agent activity without cluttering the view.

---

## 6. Do’s and Don’ts

### Do
- **Do** use `spacing-8` (2rem) and `spacing-10` (2.5rem) as your default margin between large UI sections to maintain "breathability."
- **Do** use typography weight (Semi-Bold vs Regular) to show importance rather than just color.
- **Do** use `surface-container-lowest` for cards to make them "pop" against the off-white background.

### Don't
- **Don’t** use black (`#000000`) for text. Use `on-surface` (#2b3437) to keep the look sophisticated and soft.
- **Don’t** use 1px solid borders to separate the sidebar from the main content; use a tonal background shift.
- **Don’t** use "default" blue. The `primary` (#4d44e3) is a custom-mixed indigo designed to feel more premium and less "utility."
- **Don’t** use high-intensity "glow" effects unless they represent an active AI processing state. Keep the rest of the interface static and calm.