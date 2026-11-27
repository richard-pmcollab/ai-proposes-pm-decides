---
name: install-pm-agents
description: Install the "AI Proposes, PM Decides" n8n agents for the user. Use when the user asks to install, set up or get started with this repo, the PM agents, or the n8n workflows in it.
---

# Install the PM agents

You are helping someone install this repo's seven n8n agents. Assume they are **not technical**. Use plain words, one step at a time, and wait for them to confirm each step before moving on. After each step, tell them how to check it worked.

The installer (`installer/install.mjs`) does the technical work: it creates the data tables and demo data, imports all workflows, connects the credentials and fills in the email address. Your job is to get the person ready for it, have them run it, then take them through their first test.

## Safety rules (never break these)

- **Never ask for, read or repeat** the Gemini key, the n8n API key or any password. The person pastes the Gemini key only into n8n's own credential screen, and types the n8n API key only into the installer's hidden prompt in their own terminal.
- Never create accounts, accept terms or sign in for them.
- Never click "Review and decide" or approve anything for them. That decision is always theirs.

## Step 0: Check the basics (you can do this yourself)

1. Run `node --version`. It needs version 18 or higher. If Node is missing, tell them to install the LTS version from nodejs.org, accept the defaults, then restart Claude Code.
2. Confirm the repo files are present: `installer/install.mjs` and `00-setup/workflow.json`.

## Step 1: Which n8n do they have?

Ask one question: **"Do you already have n8n? If yes, is it n8n Cloud on a paid plan, n8n Cloud on the free trial, or n8n on your own computer or server?"**

- **Paid n8n Cloud, or self-hosted** → continue with Step 2.
- **n8n Cloud free trial** → n8n's API isn't available on the trial, so the installer can't run. Say so kindly, and take them through `INSTALL.md` → sections **2** and **3B (Manual install)** instead, one step at a time.
- **No n8n yet** → tell them to create an account at n8n.io. If they'll stay on the free trial, use the manual install. If they'll upgrade or self-host, continue with Step 2.

## Step 2: Three things only they can do in n8n

Take them through each one, one at a time. Exact clicks are in `INSTALL.md` → section **2** (credentials) and **3A** (API key).

1. **Gemini credential.** Get a free key at aistudio.google.com (**Get API key → Create API key**). In n8n, **Create Credential → "Google Gemini(PaLM) Api"**, paste the key **there**, and save.
2. **Outlook credential.** In n8n, **Create Credential → "Microsoft Outlook OAuth2 API" → Connect my account**, sign in with Microsoft and accept.
3. **n8n API key.** In n8n, **Settings → n8n API → Create an API key**, then copy it. **Tell them not to paste it in this chat.**

## Step 3: They run the installer

Because the installer asks for the API key in a hidden prompt, the person runs it in **their own terminal**, not through you:

1. Tell them to open a terminal in this repo folder (Windows: open the folder in File Explorer, click the address bar, type `powershell` and press Enter. Mac: open Terminal and `cd` into the folder).
2. Tell them to run:
   ```
   node installer/install.mjs
   ```
3. It asks for their n8n address, the API key (hidden) and the email address for decision emails.

When they say it's done, read `installer/last-install.json` (it holds no secrets) and confirm which workflows were imported. If it failed, ask for the error message (not the key) and check the **Troubleshooting** table in `INSTALL.md`.

## Step 4: First test

Take them through `INSTALL.md` → section **4 (Your first test)** using **04 Intake Triage**:

- They open the workflow in n8n, click **Execute workflow** and **keep the tab open**.
- They fill in the form with the sample request (details are in `04-intake-triage/sample-data/sample-request.md`).
- The decision email arrives within a minute or so (tell them to check Junk). They click **Review and decide** and submit.

Then point them to `INSTALL.md` → section **5 (Test the other agents)** and section **6 (Use it for real)**.
