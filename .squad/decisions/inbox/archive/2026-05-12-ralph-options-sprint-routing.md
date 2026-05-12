# Options Income Sprint — Routing Observation

**Date:** 2026-05-12
**By:** Ralph (Work Monitor)
**Sprint:** options-income-extrapolation (#428–#432)

## Observation: Stacked Branches Require Merge Coordination

All three Fenster branches (#429, #430, #431) were based on McManus's `squad/428-options-estimation-engine` branch, not on `main`. This is correct for dependency isolation but creates a merge sequencing requirement: **#428 must be merged before the other PRs can be cleanly merged to main**.

If Keaton merges the PRs out of order (e.g., merging #429 before #433), the Fenster PRs will have unresolved divergence from main.

## Recommendation

Add a merge order note to the sprint tracking issue or PR descriptions when issues are chained:
1. Merge #433 (#428) first
2. Then #434, #435, #436 can be rebased/merged in any order
3. Then #437 (#432) last

The Scribe should codify this as a "stacked-branch merge protocol" in `.squad/decisions.md` for future dependency chains.

## Anti-Pattern Observed

Fenster agents were spawned before #428 was merged to main. This is intentional (per Ralph's task instructions — "once stable on branch"), but the resulting PRs target `main` while their base branch is `squad/428-*`. CI shows `unstable` for some PRs. Future sprints should either: (a) wait for #428 merge before spawning Fenster, or (b) explicitly instruct Fenster to target the dependency branch, not main.
