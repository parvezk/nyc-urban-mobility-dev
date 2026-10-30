Spin up a Claude Agent Team to research and investigate what it would take to transform this NYC Urban Mobility dashboard with interactive geospatial visualization into an engaging data-storytelling experience.

Problem Statement:
The project currently works as a tech demo but fails as a product. Two core issues:

- No insight. The visualization is visually impressive but doesn't answer any interesting or useful question. It reads as a toy — fancy rendering wrapped around stale data, with no narrative or takeaway.
- Stale, thin data. It loads outdated static data from Dec 12, 2023, covering only ~1.5 hours of taxi trips (6:00–7:30 PM). The time range is too small and limited to support any meaningful story.

Constraint — Preserve Core Technical Features:
Whatever direction the team proposes, it must retain the existing signature visualization capabilities:

- Elevated Manhattan map
- Extruded building footprints
- Animated trip paths / motion visualization
- Pulsating hotspots

Team Structure :
What the team structure do you propose, and how many agents to spawn?

I have a rough shape in mind — refine it if you see a better arrangement:

2× Researcher agents — Develop, test, validate, and challenge each other's hypotheses on what's needed to make this an engaging data-storytelling experience. They should debate adversarially, not just agree.
1× Data agent — Investigate the data source and pipeline. Identify open-source datasets we could swap in to meet the goal. If real-time/richer trip data isn't readily available, determine what alternative data is a better fit and how we could synthesize our own trip data in the correct format to serve the storytelling goal.
1× Lead agent to coordinate the work of the agent team and synthesize the result/final findings (roughly 1-2 page only) with actionable next steps.

Enviornment:
I'm using Ghostty with tmux installed.
Use split panes so each teammate gets its own pane.
