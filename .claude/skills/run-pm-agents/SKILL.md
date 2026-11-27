---
name: run-pm-agents
description: Run the "AI Proposes, PM Decides" agents on the PM's own project inputs. Use when the user asks to run the agents, run them on their project or inputs, use their team's answers, or fill in or check pm-inputs.md. Needs the agents installed first (see the install-pm-agents skill).
---

# Run the PM agents on the PM's own inputs

You help a PM (who is **not technical**) run this repo's agents on their real project. They give you their inputs, you check them, load them into n8n, and start each agent. **They make every decision** through the "Review and decide" emails.

Plain words, one step at a time. Say what you are about to do before each n8n change.

## Safety rules (never break these)

- **Never approve, reject or click "Review and decide"** for the PM. That decision is always theirs.
- **Real names never reach n8n or the AI.** Only send values from the checker's JSON output. The checker leaves out the *Privacy check* names, and refuses to pass a file in which those names appear anywhere else.
- **Real project data stays in `inputs/my-project/`.** Git ignores that folder. Never copy real data into any other file in the repo, and never commit it.
- Never ask for, read or repeat API keys or passwords.
- **Don't publish or switch on workflows, and don't change a workflow's nodes or settings,** unless the PM says yes to that specific change.
- If the AI quota runs out (an error that says 429 or "quota"), stop. Tell the PM when it resets. Don't retry in a loop.

## Step 0: Check that you can reach n8n

You run the agents through n8n's own MCP connector. Look for n8n tools such as `search_workflows`, `execute_workflow` and `add_data_table_rows`.

If they are missing, take the PM through this, one step at a time:

1. In n8n: **Settings → Instance-level MCP → Enable MCP access**. This needs the n8n owner or an admin.
2. In the same screen, make the agents visible: **Workflows enabled → Enable workflows**, and select all the "AI Proposes, PM Decides" workflows. Or, in the project's **⋯ menu → Manage MCP access → Enable MCP**.
3. In **their own terminal**, run the command from n8n's **Connect a client** dialog. For Claude Code it is:
   ```
   claude mcp add --transport http n8n https://<their-n8n-address>/mcp-server/http
   ```
   Then they restart Claude Code, run `/mcp`, choose **n8n** and sign in.

If n8n doesn't offer **Instance-level MCP**, you can't run the agents for them. Use the manual route in `inputs/README.md` instead: you check the file, and they paste each section into the agent forms.

## Step 1: Get the inputs into `inputs/my-project/pm-inputs.md`

- **The file doesn't exist yet:** copy `inputs/templates/pm-inputs.md` to `inputs/my-project/pm-inputs.md`.
- **The PM gives you team answers** (pasted text, a Word file, an Excel export): fill the sections in from them. Keep the headings, labels and table headers exactly as they are. Then:
  - **Replace real client, vendor and colleague names with code names** (for example Vendor A, Lead 1). Ask the PM which real names to list under **Privacy check**.
  - **If dates are in the past**, ask whether they are real or should move to the current calendar. Never shift dates silently.
  - **If something required is missing** (budget, an owner, a due date), ask. Never invent it.
- **The PM fills it in themselves:** point them to the file, and to `inputs/team-questions.md` if they want to ask the team.

## Step 2: Check the file

Run:

```
node inputs/check-inputs.mjs inputs/my-project/pm-inputs.md --json inputs/my-project/checked.json
```

- **Errors:** fix them with the PM, then run it again. Don't continue until it says **Ready to run**.
- **Warnings:** read each one to the PM in plain words, and continue only when they say so.
- Show them the **Agents** list and the **AI requests** total. The free Gemini tier allows about 20 requests a day. If the total is close to that, offer to run only some agents today.

## Step 3: Find the workflows and tables

Use `search_workflows` to find each agent by name ("Intake Triage", "Meeting", "Stakeholder Translator", "Retro Synthesizer", "Daily Slip Alert", "Agent Team", "Weekly Status"). Use `search_data_tables` to find the `pmd_` tables.

- **`pmd_project`, `pmd_tasks` or `pmd_milestones` is missing:** ask the PM to run **00 Setup** once from the n8n editor (it only adds what's missing), then search again.
- Read each workflow's **Settings** node (`get_workflow_details`). If its `approverEmail` isn't the approver email in the inputs, tell the PM. Change it only if they say yes.

## Step 4: Load the data

Use only `inputs/my-project/checked.json`. Every row in it carries the same `batch` stamp.

1. **Tracker:** add `project` (one row) to `pmd_project`, `tasks` to `pmd_tasks` and `milestones` to `pmd_milestones`. Old rows stay; the agents only read the newest batch.
2. **Risks:** read `pmd_raid_log` first. Add only the `raid` rows whose title isn't already there.
3. **Retro:** read `pmd_retro_feedback` for this retro name. Add only the responses that aren't already there.

Tell the PM what you added (counts, not contents).

## Step 5: Run the agents, one at a time

Skip any agent the checker marked "skipped". Start each one with `execute_workflow` in `manual` mode, in this order. After each start, check it with `get_workflow_execution` before you move to the next.

| Order | Agent | Trigger node | Inputs (`formData`) from `checked.json` |
|---|---|---|---|
| 1 | 05 Retro Synthesizer | `PM Synthesize Form` | `retro`: the retro name, `teamTo`: "" |
| 2 | 04 Intake Triage | `Request Intake Form` | one run per item in `requests`, with its fields as they are |
| 3 | 02 Meeting → Actions | `PM Input Form` | `meeting` (meetingName, meetingDate, attendees, transcript) |
| 4 | 03 Stakeholder Translator | `PM Input Form` | `update` (projectName, update, internalOnly, audiences, clientName); leave execTo/teamTo/clientTo empty |
| 5 | 06 Daily Slip Alert | `Test Run` | none |
| 6 | PM Agent Team | `Test Run` | none (it takes 3–6 minutes) |
| 7 | 01 Weekly Status | `Test Run` | none |

What each status means:

- **`waiting`**: the decision email has gone to the PM. Tell them to open it (check Junk) and click **Review and decide**.
- **`success`**: the run finished without needing a decision. For example, 05 said "not enough responses", 06 found no slip, or 01 saved its Outlook draft.
- **`error`**: read the error, explain it in plain words, and stop. A 429 or "quota" error means the free AI limit for today is used up.

## Step 6: Wrap up

Give the PM a short table: each agent, what happened, and which emails are waiting for their decision.

Two known limits to mention when they apply:

- **The "Review and decide" page says "No action required".** Test runs sometimes don't resume. Tell the PM to open that workflow in the n8n editor, click **Execute workflow**, and fill in the form there. The permanent fix is to publish the workflows, which also switches on their schedules (Agent Team and 01 on Fridays, 06 on weekdays). Do that only if the PM says yes.
- **Decision links expire after 1–3 days.** Nothing is written if the PM doesn't decide.
