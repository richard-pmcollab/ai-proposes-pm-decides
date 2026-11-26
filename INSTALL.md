# Install guide: from zip file to your first approval email

This guide assumes you have **never used n8n** and are not technical. Follow the steps in order. Each one says what you'll see when it worked.

**Time needed:** about 45 minutes the first time.

---

## What you need before you start

| You need | Why | Cost |
|---|---|---|
| A computer with a web browser (Chrome, Edge, Safari or Firefox) | Everything happens in the browser | Free |
| An **n8n Cloud** account | n8n is the app that runs the agents | Free trial, then a paid plan (see [n8n.io/pricing](https://n8n.io/pricing)) |
| A **Google account** | To get a free Gemini AI key | Free |
| A **Microsoft Outlook / Hotmail / Microsoft 365** email account | The agents send you decision emails and save drafts | Free (Outlook.com) |

**You do not need to install anything on your computer.** No Python, no coding tools. n8n Cloud runs in the browser. (Want to run n8n on your own computer instead? See [Option B](#option-b-run-n8n-on-your-own-computer-advanced) at the end.)

---

## Step 1: Download and unzip the files

1. On the GitHub page of this repo, click the green **Code** button, then **Download ZIP**.
2. Find the file in your **Downloads** folder. It's called `ai-proposes-pm-decides-main.zip`.
3. Unzip it:
   - **Windows:** right-click the file → **Extract All…** → **Extract**.
   - **Mac:** double-click the file.
4. You now have a folder called `ai-proposes-pm-decides-main`. Inside are folders like `00-setup`, `agent-team`, `02-meeting-to-actions`. Each one contains a file called **`workflow.json`**. Those are the files you'll import.

✅ **It worked if** you can open the folder and see `workflow.json` inside `00-setup`.

> **Shortcut:** you can skip the zip. In Step 5, choose **Import → From URL** and paste the file's "Raw" link from GitHub instead.

---

## Step 2: Create your n8n account

1. Go to **[n8n.io](https://n8n.io)** and click **Get started** (or **Start free trial**).
2. Sign up with your email and choose a name for your workspace (for example `my-pm-agents`).
3. Wait a minute while n8n creates your space. You'll land on the **Overview** page.

✅ **It worked if** you see the n8n screen with **Overview** in the left menu.

---

## Step 3: Get your free Gemini AI key

1. Go to **[aistudio.google.com](https://aistudio.google.com)** and sign in with your Google account.
2. Click **Get API key** (left menu), then **Create API key**.
3. Click **Copy**. It's a long code starting with `AI…`.
4. Keep this tab open, or paste the key into a note for the next step.

⚠️ Treat this key like a password. Don't share it or post it anywhere.

---

## Step 4: Connect Gemini and Outlook to n8n (one time)

n8n calls these connections **credentials**. You create each one once, and every agent reuses it.

### 4a. Gemini
1. In n8n, click **Overview** (left menu) → the arrow next to **Create Workflow** → **Create Credential**.
2. Search for **Google Gemini(PaLM) Api** and select it.
3. Paste your key into **API Key**. Leave **Host** as it is.
4. Click **Save**.

✅ You see a green "Connection tested successfully" message.

### 4b. Outlook
1. **Create Credential** again and search for **Microsoft Outlook OAuth2 API**.
2. Click **Connect my account** (or **Sign in with Microsoft**).
3. A Microsoft window opens. Sign in with your Outlook email and click **Accept**.
4. Click **Save**.

✅ The credential shows as "Account connected".

---

## Step 5: Import and run the Setup workflow

This creates the small storage tables the agents share and adds demo data.

1. In n8n, click **Overview** → **Create Workflow**. An empty canvas opens.
2. Click the **⋯** (three dots) next to the workflow name at the top → **Import** → **From File…**
3. Choose `00-setup/workflow.json` from the folder you unzipped.
4. The canvas fills with boxes. Press **Ctrl+S** (Mac: **Cmd+S**) to save.
5. Click **Execute workflow** at the bottom of the screen.
6. After a few seconds, the boxes turn green.

✅ **It worked if** **Overview → Data tables** now lists 6 tables whose names start with `pmd_`.

---

## Step 6: Import an agent (start with Intake Triage, the quickest)

1. **Overview** → **Create Workflow** → **⋯** → **Import** → **From File…** → choose `04-intake-triage/workflow.json`. Press **Ctrl+S**.
2. **Connect the credentials.** Boxes with a red warning need a credential:
   - Double-click each one (for example **Gemini: Triage**, **Send Decision Email**, **Write-back: Save Reply as Draft**).
   - In the **Credential** dropdown, choose the one you made in Step 4. Close the box.
   - Repeat until no red warnings are left.
3. **Set your email.** Double-click the **Settings** box and replace `YOUR_EMAIL@example.com` with **your** Outlook address. Close it and press **Ctrl+S**.

✅ **It worked if** there are no red warnings on the canvas.

> Every agent except 00 and 01 has a **Settings** box. Always put your email there; it's where the decision emails go.

---

## Step 7: Test it and approve your first proposal

1. **Keep the workflow open in this browser tab for the whole test.** (n8n only listens for your decision on test runs while the editor is open.)
2. Click **Execute workflow**. Because this agent starts with a form, n8n opens the form in a new tab.
3. Fill in the form. To match the demo data, use:
   - **Title:** `Show pipeline by region on the sales dashboard`
   - **Impact:** `Affects customers or revenue`
   - **Needed by:** a date about 10 days from today
   - Any name and a made-up email such as `test@example.com`

   Then click **Submit request**.
4. Within about a minute, an email arrives in your Outlook inbox: **[Approval needed] P1 request: …**. **Check the Junk folder too.** If it's there, mark it **Not junk**.
5. Open the email and click **Review and decide**. Choose **Accept** or **Reject**, optionally add a comment, and click **Submit**.
6. Back in n8n, the remaining boxes turn green.

✅ **It worked if** **Overview → Data tables → `pmd_audit_log`** shows a new row with your decision and comment.

🎉 That's the full loop: **AI proposes, you decide.**

---

## Step 8: Add the other agents

Repeat **Step 6** and **Step 7** for each folder. What to expect from each:

| Folder | How you test it | Takes |
|---|---|---|
| `agent-team` | Click **Execute workflow** (no form) | About 2–3 min |
| `01-weekly-status-agent` | Click **Execute workflow**. A **draft** appears in Outlook, with no decision step | About 1 min |
| `02-meeting-to-actions` | The form opens. Paste the text from `02-meeting-to-actions/sample-data/sample-transcript.txt` | About 1 min |
| `03-stakeholder-translator` | The form opens. Use the text from `03-stakeholder-translator/sample-data/sample-input.md` | About 1 min |
| `05-retro-synthesizer` | In the **Execute workflow** menu, choose **PM Synthesize Form**, then enter `Atlas Sprint 14` | About 1 min |
| `06-daily-slip-alert` | Click **Execute workflow**. The demo data contains a slip, so an alert arrives | About 1 min |

---

## Step 9: Turn them on for real use

When you're happy, open each agent and click **Publish** (top right). Then:

- **Scheduled agents** (agent team on Fridays, Weekly Status on Fridays, Slip Alert on weekdays) run by themselves.
- **Form agents:** double-click the form box (for example **Request Intake Form**) and copy the **Production URL**. Bookmark it, or share it with your team (for example the Intake form with stakeholders, or the retro feedback form with your team).
- Once published, decision links work **without** n8n being open.

To use your **real project data**, open the box called **Read Project Tracker** (or **Load Project Tracker (Sample)**) and replace it with a connection to your own tool: Excel, Google Sheets, Jira or Asana. Keep the same field names. This step is optional and a little more technical.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| **The run sits on a Gemini box for minutes** | The free Gemini key hit its per-minute or daily limit, and n8n keeps retrying. Wait; it usually finishes. If it's stuck for more than 10 minutes, click **Stop** and try again later (the daily limit resets once a day). |
| **The decision page says "No action required"** | The test run wasn't open in the editor when you clicked. Run the test again and keep the tab open, or **Publish** the workflow. |
| **No email arrives** | Check **Junk**. Check the email address in **Settings**. Check that the Outlook credential is connected (Step 4b). |
| **Red warning on a box** | Double-click it and choose your credential in the dropdown. |
| **"Data table not found" error** | Run **00 Setup** (Step 5). |
| **Slip Alert sends nothing** | That's normal on a quiet day: it only emails when a milestone moved. To see an alert again, change a `forecast` date in the **Read Project Tracker** box. |

---

## Option B: run n8n on your own computer (advanced)

Use this only if you're comfortable with a few technical steps. It's free, but approval links only work on that computer.

1. Install **Node.js** (the "LTS" version) from [nodejs.org](https://nodejs.org). Accept all the defaults.
2. Open **PowerShell** (Windows) or **Terminal** (Mac) and run:
   ```
   npx n8n
   ```
3. When it says it's ready, open **http://localhost:5678** in your browser and create an owner account.
4. Continue from **Step 3** of this guide.

⚠️ **Outlook on a self-hosted n8n** needs extra setup: you must register an app in Microsoft Entra (Azure) and paste its Client ID and Secret into the Outlook credential. n8n's docs explain it: search for "n8n Microsoft OAuth credentials". This is the main reason beginners should use n8n Cloud.
