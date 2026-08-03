## 2024-08-03 - Focus states and monochromatic UI
**Learning:** When working with monochromatic or strictly dark-themed interfaces, standard focus rings can be hard to see. Using slate-400 and offset styles in Tailwind (`focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900`) creates a high-contrast focus indicator that respects the color constraints.
**Action:** Always test keyboard focus against dark backgrounds and use specific offset colors to guarantee visibility without breaking the design system.
