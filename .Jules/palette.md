## 2023-10-27 - Monochromatic UI Focus States & Accents
**Learning:** In a monochromatic UI, standard browser focus and blue accents violate constraints, but removing them hurts a11y.
**Action:** Always use specific, high-contrast neutral offset rings (`focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900`) for interactive elements, and use neutral accents (`accent-slate-300`) for sliders to ensure visibility against dark backgrounds without introducing unauthorized colors.
