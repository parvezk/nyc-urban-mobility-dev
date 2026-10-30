# NYC Urban Mobility — v1 Plan: "Watch New York Wake Up"

**Status:** direction chosen by user (2026-06-25), plan approved 2026-07-23, in build. This file
supersedes the earlier "Exhale" exploration (rejected: too academic/dense). Team transcripts in `team/`.

## Plan deltas (2026-07-23, user-approved)

1. **Month: June 2026** — `202606-citibike-tripdata.zip` verified on S3 (July drops ~mid-Aug).
   Caption becomes "…on one day in June…". Pick a representative Wednesday (Jun 10 or 17),
   confirmed against per-day trip counts (skip anomalous rain-dip days).
2. **Routes are derived, not recorded.** The monthly CSV has real endpoints + timestamps only —
   no route (and Citi Bike's *live* GBFS feed only shows parked bikes; privacy). OSRM's bicycle
   profile infers the most plausible street path; real duration is interpolated along it.
   Site fine print: *"routes are estimated street paths, not GPS traces."*
3. **Why sample ~6k trips** (of ~120–150k/day): 60fps render budget (~6k paths × ~30 vertices),
   payload (~0.7 MB gzip vs the 2 MB SLO), and legibility — the rush-hour surge reads better as
   distinct streaks than a solid smear. Random sampling across the day preserves the hourly
   rhythm. Render-test 6k → 10k and keep the densest size that holds 60fps.
4. **Why Docker / self-hosted OSRM:** the free public OSRM routes cars only (no bicycle profile)
   and rate-limits (~30–40 min + 429s for 6k requests). A local bike-profile container routes 6k
   trips in ~1–2 min with correct one-ways/bridge paths. Runs once locally — not in production.
5. **Multi-hotspot pulses (upgraded from single busiest-station dot):** per 5-min bucket ×
   station-cluster, count trips *in motion*; pulses bloom/fade in sync with the 75s loop (top
   5–8 zones per moment, low opacity — trips stay the star). Headline stat computed from the
   FULL day, not the sample: *"Peak minute: N bikes in motion at once."*
6. **Timestamps stay absolute epoch-ms** (not relative): the HUD clock and min/max-time logic
   already work natively with epochs — June 2026 flows through with zero timestamp changes.

## The pivot
Kill the stale Dec-2023 yellow-taxi data. **Hero layer = real NYC Citi Bike trips, one fresh
day, animated as moving light over the existing 3D Manhattan.** Single layer, ship-fast, made to
post on LinkedIn/X. Animated trip path stays the star; buildings + tilt = plain scenery; one
pulsing hotspot is an optional accent.

## Why Citi Bike (vs the alternatives we scouted)
- **Real, individual, fresh trips** with exact start/end lat-lon — latest file `202605` (May
  2026) is **~3–4 weeks old** (verified live on S3), vs the old 2.5-year-old taxi slice.
- **Lowest engineering risk** — reuses the existing OSRM routing ETL almost as-is.
- We also confirmed: true **real-time** is possible later via **MTA Bus Time** (live bus GPS) —
  parked as a strong v2. Subway real-time is a dead end (no coordinates). Citi Bike's *live* feed
  is only parked bikes, which is why we use its **historical monthly trips** instead.

## The hook (chosen)
> **"Watch New York wake up."**
> One ordinary day in May, every Citi Bike ride drawn as a streak of light — the whole city
> breathing in fast-forward.
>
> **Caption:** *Every Citi Bike ride in NYC on one day in May, drawn as moving light. Watch the
> city wake up, rush, and wind down in 90 seconds 🚲 [demo link]*

## The experience (v1)
24h of one weekday compressed into a **~75–90s cinematic loop**, with the existing time scrubber.
- **Open already-alive** (mid-rush or auto-fast-forward the first ~5s) — do NOT cold-open on the
  empty 4 AM city (the #1 reason a stranger bounces in 10s).
- Surge ignites → midday calm → evening surge → trickle → seamless loop.
- One real, computed stat surfaced (e.g. "peak minute: 1,900 bikes moving at once") — **compute
  from the actual day's data; do not hardcode a placeholder number.**
- *Optional accent (v1.1):* a single pulsing dot on the busiest station of the day.

## Build plan (~1 day, 6–8h) — reuses the 3-stage ETL
| Stage | File | Change |
|:--|:--|:--|
| 1 | `scripts/etl/1-aggregate-remote-duckdb.mjs` | Rewrite: drop Socrata/zone-join. Download `202605` zip, glob the multi-part CSVs, pick one weekday (e.g. **Wed 2026-05-13**), `USING SAMPLE 6000 ROWS`, emit start/end lat-lon + relative-ms times (direct lat-lon — no centroid lookup). |
| 2 | `scripts/etl/2-osrm-routing.mjs` | **Driving → bicycle profile** (self-host OSRM bike in Docker — fixes correctness *and* rate-limit/IP risk; routes 6k trips in ~1–2 min). `overview=full → simplified` (≈4× smaller). Output unchanged `{vendor_type, path:[[lng,lat,t],…]}`. |
| 3 | `scripts/etl/3-supabase-seed.mjs` | No change. |
| API | `app/api/trips/route.ts` | No change. |
| UI | `components/MapViewport.tsx` | `TIME_MULTIPLIER` → ~1150 (24h ≈ 75s); recolor by `rideable_type` (electric vs classic). |

- **Output size:** ~6k trips → **~0.6–0.8 MB gzip**, under the 2 MB SLO, no chunking.
- **Automation:** manual monthly re-run for v1; Vercel Workflows / GitHub Actions cron deferred to v2.

## Biggest risks (and the fixes, already folded in)
1. **Routing** — wrong profile + fragile public OSRM at 6k requests → **self-hosted OSRM bicycle in Docker** (one move fixes all three).
2. **Boring cold open** → start mid-rush / fast-forward the empty hours.
3. **Citi Bike license** is non-commercial — fine for a portfolio demo; note it before any commercial use.

## Done when
The map plays a smooth ~75s loop of a real May-2026 NYC bike day, opens already-alive, shows one
computed stat, and is captioned and posted.
