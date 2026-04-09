# UX Design Specification & Branding Concept

This document serves as the UX foundation for the modernized NYC Urban Mobility project. As requested, this phase is distinct from the engineering implementation and can be iterated heavily using IDE and Figma AI workflows.

## 1. Brand Identity & Aesthetic Direction

### The "Anti-DevTool" Approach
We are explicitly avoiding the hyper-saturated, dark-mode-first aesthetic popularized by developer tools (e.g., Supabase, Vercel, Neon, sourcegraph) which rely on harsh black backgrounds with neon green, purple, or blue accents.

Instead, the UI will prioritize a **Clean, Minimalist, Editorial-style** design that feels like a modern data journalism piece (reminiscent of the New York Times Upshot or Bloomberg Data viz).

### Core Aesthetic Principles
- **Light Theme Default**: A clean, off-white or soft cream background (`#F9F9F8` or `#FAFAFA`) to reduce eye strain, making the brightly colored map data pop organically.
- **High legibility, Low noise**: UI frames, borders, and panels should be almost invisible. Use subtle drop shadows and generous whitespace instead of harsh borders.
- **Monochromatic UI**: The application interface itself (buttons, typgraphy, sidebars) should be strictly neutral (shades of gray/charcoal) so that the **Data is the only source of color**.
- **Typography**: Opt for elegant, highly legible Neo-grotesque or geometric sans-serif typefaces (e.g., `Inter`, `Geist`, `Helvetica Now`, or `Satoshi`).

## 2. Layout & Spatial Architecture

The app is essentially a spatial data dashboard. The layout should maximize map visibility while keeping controls accessible.

- **Floating Panels**: Instead of a traditional heavy sidebar that squishes the map, Layer Controls and Data Filters should exist as translucent, floating glassmorphism panels (with very subtle blur) superimposed over the map.
- **Progressive Disclosure**: Advanced controls (like granular time scrubbing, specific dataset toggles) should be hidden by default in collapsible accordion menus to maintain a minimalist initial state.
- **Non-Obtrusive Legend**: A clear, sticky legend at the bottom corner that dynamically updates based on the active layers.

## 3. WebGL Map Styling (MapLibre Basemap)

Because we are avoiding the "dark hacker" aesthetic, the basemap must be re-thought:
- **Muted / Alabaster Basemap**: Use a light, desaturated map style. Roads should be soft greys, water bodies a very pale slate blue. 
- **Data Tints**: Against a light basemap, taxi heatmaps and trip arcs can utilize vibrant, distinct palettes (e.g., a fiery gradient of yellow-orange-red for congestion, or deep indigo to cyan for trip velocity). 

## 4. Figma & IDE Handoff Workflow

To ensure high-fidelity design execution, we will establish a strong bidirectional workflow between standard UI design tools and the IDE.

### Establishing the Source of Truth
1. **Figma Setup**: Create a Figma file with foundational Design Tokens (Variables):
   - Colors (Backgrounds, Surfaces, Text, Data Palettes)
   - Typography scales
   - Spacing variables
2. **Figma AI Iteration**: Designers can use Figma AI to rapidly generate panel variations and layout structures based on this "minimalist data-journalism" prompt.

### Handoff to Code
1. **Exporting Tokens**: Sync Figma variables directly to a `tailwind.config.ts` using plugins or manual token mapping.
2. **shadcn/ui Customization**: The developer IDE side will map these tokens directly into the `shadcn/ui` theme configuration (`app/globals.css`), overriding shadcn's default styling to remove heavy borders and align with the minimalist spec.
3. **Continuous Iteration**: As the application evolves, any visual component updates can be drafted back in Figma, while layout logic remains in React.

## 5. Agent Skills & Tooling Utilization

To implement this UI phase highly efficiently, the AI Agent team will leverage the following specialized skills running via the IDE:

- **`frontend-design` Skill**: An available agent skill installed specifically to generate production-grade, distinctive interfaces escaping the generic "AI aesthetic". It will interpret our Tailwind tokens and generate high-fidelity `shadcn/ui` shell components.
- **Figma Hand-off Plugins**: Native plugins will be used to bridge Figma components into Next.js React nodes, ensuring the agent doesn't need to guess CSS pixel values.
- **`next-best-practices` Skill**: Leveraged during layout generation to ensure RSC (React Server Component) boundaries are drawn correctly between static UI shells and dynamic MapLibre canvases.
