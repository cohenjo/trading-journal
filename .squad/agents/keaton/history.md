7. **Turbopack: base40→base38 hash encoding** ← RELEVANT (app uses `--turbopack`)
8. CI-only node 24 fix (irrelevant)
9. Fix `type: module` with standalone/adapters (N/A)
10. Propagate adapter preferred regions (N/A — no adapters)
11. **Don't drop FormData entries** ← POTENTIALLY RELEVANT (server actions)
12. **Turbopack: LocalPathOrProjectPath PostCSS config resolution** ← RELEVANT (postcss.config.mjs present)

**Alert authenticity:** The "keep your device secure" wording is misleading — no CVEs, no security advisories in this release. Routine backport patch. Real drift, no urgency.

**Risk:** LOW. Pure bugfixes, zero API changes, zero behavior changes for code paths not affected.

**Decision file:** `.squad/decisions/inbox/keaton-nextjs-16-2-7-bump.md`
**Skill extracted:** `.squad/skills/verifying-upstream-advisories/SKILL.md`

## 2026-06-04: Next.js 16.2.7 Patch Bump Analysis

**Decision:** approved routine patch (LOW risk)
**Outcome:** directed Fenster Phase 1; 4 app-relevant fixes identified

Analyzed next.js 16.2.7 release (12 changes). Security alert was phishing-flavored but underlying drift real.

App-relevant fixes:
- Server action forwarding loop with middleware rewrites
- Turbopack base40→base38 hash encoding
- FormData entries preservation
- Turbopack PostCSS config resolution

**Skill authored:** `.squad/skills/verifying-upstream-advisories/SKILL.md`

**Related decision:** Approved; decision merged to `.squad/decisions.md` on 2026-06-04T11:00 UTC
