# Install guide

This is the only install guide for this repo. It's written for people who have **never used n8n** and aren't technical. Each step says what you'll see when it worked.

## Choose your path

| Your n8n | Path | Time |
|---|---|---|
| **n8n Cloud on a paid plan**, or **n8n on your own computer/server** | **Quick install:** one command does the setup | about 15 min |
| **n8n Cloud free trial** (n8n's API isn't included in the trial) | **Manual install:** a few more clicks | about 45 min |

**Using Claude Code?** Open this folder in Claude Code and type **"install the PM agents"**. Claude walks you through whichever path fits (see [Install with an AI assistant](#install-with-an-ai-assistant)).

---

## 1. What you need

| You need | Why | Cost |
|---|---|---|
| A web browser | n8n runs in the browser | Free |
| An **n8n** account ([n8n.io](https://n8n.io)) | n8n is the app that runs the agents | Free trial, then paid ([pricing](https://n8n.io/pricing)), or free if you run it yourself |
| A **Google account** | To get a free Gemini AI key | Free |
| A **Microsoft Outlook / Hotmail / Microsoft 365** email | The agents email you and save drafts | Free (Outlook.com) |
| **Node.js 18+** (quick install only) | Runs the installer. Get the LTS version from [nodejs.org](https://nodejs.org) | Free |

**Get the files:** on this repo's GitHub page click **Code → Download ZIP**, then unzip it (Windows: right-click → **Extract All**; Mac: double-click).

---

## 2. Connect Gemini and Outlook to n8n (both paths)

n8n calls these connections **credentials**. You create each one once, and every agent uses it.

**Gemini**
1. Go to [aistudio.google.com](https://aistudio.google.com) → **Get API key** → **Create API key** → **Copy**. Treat it like a password.
2. In n8n: **Overview** → the arrow next to **Create Workflow** → **Create Credential**.
3. Search for **Google Gemini(PaLM) Api**, paste the key into **API Key**, and click **Save**.

✅ You see "Connection tested successfully".

**Outlook**
1. **Create Credential** again → **Microsoft Outlook OAuth2 API** → **Connect my account**.
2. Sign in with Microsoft and click **Accept**, then **Save**.

✅ It shows "Account connected".

---

## 3A. Quick install (paid n8n Cloud or self-hosted)

1. **Create an n8n API key:** in n8n go to **Settings → n8n API → Create an API key**, then copy it. Don't paste it into any chat.
2. **Open a terminal in the unzipped folder:**
   - **Windows:** open the folder in File Explorer, click the address bar, type `powershell` and press **Enter**.
   - **Mac:** open **Terminal**, type `cd `, drag the folder into the window and press **Enter**.
3. **Run the installer:**
   ```
   node installer/install.mjs
   ```
4. Answer its three questions:
   - your n8n address, for example `https://yourname.app.n8n.cloud`
   - the API key (hidden while you type)
   - your email address for decision emails

It finds your Gemini and Outlook credentials, creates the 9 data tables with demo data, imports all 7 agents, wires them up and fills in your email.

✅ **It worked if** it ends with "Everything is installed" and you see the agents in n8n under **Overview**.

Running it again is safe: it keeps existing tables and data, and skips workflows that already exist.

Now go to [4. Your first test](#4-your-first-test).

---

## 3B. Manual install (n8n Cloud free trial)

**a. Create the data tables (once)**
1. In n8n: **Overview → Create Workflow**, then **⋯** (next to the workflow name) → **Import** → **From File…** → `00-setup/workflow.json`. Press **Ctrl+S** (Mac: **Cmd+S**).
2. Click **Execute workflow**.

✅ **Overview → Data tables** shows 9 tables starting with `pmd_`.

**b. Import each agent.** For each folder you want (`agent-team`, `01-weekly-status-agent` … `06-daily-slip-alert`):
1. **Overview → Create Workflow → ⋯ → Import → From File…** → that folder's `workflow.json`. Save.
2. Double-click every box with a red warning and choose your credential from step 2.
3. Double-click the **Settings** box and replace `YOUR_EMAIL@example.com` with your email. (01 Weekly Status has no Settings box.) Save.

✅ No red warnings left on the canvas.

---

## 4. Your first test

Start with **04 Intake Triage**, the quickest.

1. Open **AI Proposes, PM Decides: 04 Intake Triage** in n8n.
2. Click **Execute workflow** and **keep this tab open until the end**. (Test runs only listen for your decision while the editor is open.)
3. A form opens. Use the sample request from `04-intake-triage/sample-data/sample-request.md`, or just:
   - **Title:** `Show pipeline by region on the sales dashboard`
   - **Impact:** `Affects customers or revenue`
   - **Needed by:** about 10 days from today
   - any name, and an email like `test@example.com`
4. Within about a minute, an email arrives: **[Approval needed] P1 request: …**. Check **Junk** too, and mark it **Not junk** if it landed there.
5. Click **Review and decide**, choose **Accept** or **Reject**, add a comment if you like, and **Submit**.

✅ **It worked if** **Overview → Data tables → `pmd_audit_log`** has a new row with your decision and comment. 🎉

---

## 5. Test the other agents

| Agent | How to test | Takes |
|---|---|---|
| **agent-team** | **Execute workflow** (no form) | 2–3 min |
| **01 Weekly Status** | **Execute workflow**. A **draft** appears in Outlook (no decision step) | ~1 min |
| **02 Meeting → Actions** | Form: paste `02-meeting-to-actions/sample-data/sample-transcript.txt` | ~1 min |
| **03 Stakeholder Translator** | Form: use `03-stakeholder-translator/sample-data/sample-input.md` | ~1 min |
| **05 Retro Synthesizer** | **Execute workflow** menu → **PM Synthesize Form** → `Atlas Sprint 14` | ~1 min |
| **06 Daily Slip Alert** | **Execute workflow**. The demo data contains a slip, so an alert arrives | ~1 min |

---

## 6. Use it for real

- **Turn agents on:** open each one and click **Publish** (top right). Scheduled agents then run on their own: the agent team and Weekly Status on Fridays, the Slip Alert on weekdays. Once published, decision links work without n8n open.
- **Form links:** double-click a form box (for example **Request Intake Form**) and copy its **Production URL** to bookmark or share.
- **Your own project data:** fill in one page and let Claude Code run every agent on it. See [`inputs/README.md`](inputs/README.md). Advanced: you can instead replace the **Read Project Tracker** / **Load Project Tracker** box with a direct connection to Excel, Google Sheets, Jira or Asana, keeping the same field names.
- **Remove demo data** from the `pmd_` tables when you start for real.

---

## Install with an AI assistant

**Claude Code (recommended):** this repo includes a skill. Open the unzipped folder in Claude Code and type **"install the PM agents"**. Claude checks your computer, walks you through steps 2–3, has you run the installer, and takes you through the first test. It never asks for your keys or passwords.

Once installed, say **"run the PM agents on my inputs"** to run them on your own project ([`inputs/README.md`](inputs/README.md)).

**Any chat AI (ChatGPT, Gemini, Claude.ai):** upload the zip (or paste this repo's link, or paste this guide) and send:

```text
Help me install this repo by following INSTALL.md one step at a time. I'm not technical:
use plain words, wait for me to say "done" after each step, and tell me how to check it worked.
First ask which n8n I have, so you pick the quick or manual path.
Never ask me for passwords, my Gemini key or my n8n API key, and never approve anything for me.
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| **Installer: "n8n rejected the API key"** | Create a new key in **Settings → n8n API** and run it again. |
| **Installer: "No n8n API found"** | Check the address. On the n8n Cloud free trial there's no API, so use the [manual install](#3b-manual-install-n8n-cloud-free-trial). |
| **Installer: "No Google Gemini / Outlook credential found"** | Do [step 2](#2-connect-gemini-and-outlook-to-n8n-both-paths) first, then run the installer again. |
| **A run sits on a Gemini box for minutes** | The free Gemini key hit its per-minute or daily limit and n8n keeps retrying. Wait; it usually finishes. If it's stuck for more than 10 minutes, click **Stop** and try later. |
| **Decision page says "No action required"** | The test run wasn't open in the editor. Run it again and keep the tab open, or **Publish** the workflow. |
| **No email arrives** | Check **Junk**, check the email in the **Settings** box, and check the Outlook credential is connected. |
| **Red warning on a box** | Double-click it and choose your credential. |
| **"Data table not found"** | Run the installer, or run **00 Setup** (manual install step a). |
| **Slip Alert sends nothing** | Normal on a quiet day: it only emails when a milestone moved. |

---

## Running n8n on your own computer

It's free, but approval links only work on that computer, and Outlook needs extra setup.

1. Install **Node.js** (LTS) from [nodejs.org](https://nodejs.org).
2. In a terminal, run `npx n8n`. When it's ready, open **http://localhost:5678** and create an owner account.
3. **Outlook on self-hosted n8n** needs an app registered in Microsoft Entra (Azure), with its Client ID and Secret added to the Outlook credential. Search "n8n Microsoft OAuth credentials" in n8n's docs.
4. Continue from [step 2](#2-connect-gemini-and-outlook-to-n8n-both-paths). The quick install works here, using `http://localhost:5678` as the address.
