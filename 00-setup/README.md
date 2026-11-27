# 00 · Setup (run once)

> Creates the 9 data tables every agent shares, and adds a small amount of fictional demo data so each agent works on its first run.

**Status:** ✅ tested. Import [`workflow.json`](workflow.json).

## What it creates

| Data table | Used by | Demo data added |
|---|---|---|
| `pmd_raid_log` | Agent team, Meeting → Actions, Daily Slip Alert | 2 risks |
| `pmd_audit_log` | All agents | none |
| `pmd_action_log` | Meeting → Actions, Retro Synthesizer | none |
| `pmd_intake_log` | Intake Triage | 2 existing requests (one makes the duplicate check work) |
| `pmd_retro_feedback` | Retro Synthesizer | 6 anonymous responses for "Atlas Sprint 14" |
| `pmd_milestone_snapshot` | Daily Slip Alert | Yesterday's forecasts, so the first run finds a slip |
| `pmd_project` | Agent team, Weekly Status | none (your project name, sponsor, budget, end date) |
| `pmd_tasks` | Agent team, Weekly Status, Daily Slip Alert | none (your tasks) |
| `pmd_milestones` | Agent team, Weekly Status, Daily Slip Alert | none (your milestones) |

The last three hold **your own project** (see [`inputs/README.md`](../inputs/README.md)). While `pmd_tasks` and `pmd_milestones` are empty, the agents use their built-in fictional sample.

## How to run it

**Using the one-command installer?** Skip this. The installer creates the same tables and demo data for you, reading them from this file.

**Manual install:**

1. Import `workflow.json` into n8n (see [INSTALL.md](../INSTALL.md), manual install).
2. Open it and click **Execute workflow**.
3. Go to **Overview → Data tables**. You should see the 9 tables above.

**Safe to run again.** Tables that already exist are kept as they are and missing ones are added, and demo data is only added to tables that are still empty. When you start using the agents for real, you can delete the demo rows from the tables.

No credentials needed.
