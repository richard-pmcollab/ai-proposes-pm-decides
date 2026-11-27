# Your project inputs

The agents ship with a fictional sample project, so they work right after install. This folder is how you give them **your own** project: one page you fill in, a checker that catches problems before anything reaches the AI, and a Claude Code skill that runs every agent from it.

## How it works

1. **Collect.** Fill in [`templates/pm-inputs.md`](templates/pm-inputs.md) yourself, or send your team the questions in [`team-questions.md`](team-questions.md) and copy their answers in.
2. **Check.** Run the checker. It flags missing fields, wrong formats, past dates, too few retro responses and any real names you listed under *Privacy check*.
3. **Run.** In Claude Code, say **"run the PM agents on my inputs"**. Then approve or reject each proposal from your decision emails. Nothing is written before you decide.

## Step by step

Copy the template into `inputs/my-project/`. Git ignores that folder, so your real data never gets committed:

```powershell
mkdir inputs\my-project; copy inputs\templates\pm-inputs.md inputs\my-project\pm-inputs.md
```

Fill it in, replacing the example rows. Then check it:

```powershell
node inputs/check-inputs.mjs inputs/my-project/pm-inputs.md
```

When it says **Ready to run**, open Claude Code in the repo folder and say *"run the PM agents on my inputs"*. The [`run-pm-agents`](../.claude/skills/run-pm-agents/SKILL.md) skill loads your data into n8n, starts each agent in a safe order, and tells you which decision emails to look out for.

## What each section feeds

| Section | Agent | How it gets there |
|---|---|---|
| Project, Tasks, Milestones | Agent Team, 01 Weekly Status, 06 Daily Slip Alert | Loaded into `pmd_project`, `pmd_tasks` and `pmd_milestones` |
| Risks and issues | Agent Team (RAID) | Added to `pmd_raid_log` (new titles only) |
| Meeting | 02 Meeting → Actions | Sent as the agent's form |
| Stakeholder update | 03 Stakeholder Translator | Sent as the agent's form |
| Requests | 04 Intake Triage | One form per request |
| Retro | 05 Retro Synthesizer | Added to `pmd_retro_feedback`, no names |

Leave a section empty to skip its agent. While `pmd_tasks` and `pmd_milestones` are empty, the agents keep using the fictional sample. Each new load gets a time stamp (`batch`), and the agents read only the newest one, so you can reload every week.

## Good to know

- **Privacy.** Put real client, vendor and colleague names under *Privacy check* and use code names everywhere else. The checker refuses to continue while a listed name appears anywhere else in the file. The free Gemini tier may use what you send it to improve Google's products.
- **AI limit.** The free Gemini tier allows about 20 requests a day, and a full run uses about 13. The checker shows the total before you start.
- **Approvals stay yours.** Claude starts the agents, but only you can click **Review and decide**.
- **What you need first.** The agents must be installed ([`INSTALL.md`](../INSTALL.md)), and n8n's MCP connector must be connected to Claude Code. The skill walks you through connecting it. It needs n8n's **Settings → Instance-level MCP**, which n8n lists for Cloud Starter, Pro and Enterprise. For the free trial and self-hosted n8n, check whether that menu is there ([which plan includes what](../INSTALL.md#choose-your-path)).

## Without Claude Code

You can still use the page by hand. Run the checker, then:

- **Meeting, Stakeholder update and Requests:** paste each one into its agent's form in the n8n editor.
- **Tracker, Risks and Retro:** add the rows under **Overview → Data tables** in n8n.
