# Install with an AI assistant

You can hand most of this installation to an AI assistant such as Claude, ChatGPT or Gemini. **You do the few steps that need your own accounts and sign-ins** (about 15 minutes), and the AI guides you through the rest or does it for you.

> Prefer to do it yourself? Follow [INSTALL.md](INSTALL.md) instead. It's the same process, written for humans.

---

## Which kind of AI do you have?

| Your AI | What it will do |
|---|---|
| **A chat AI in the browser** (ChatGPT, Gemini, Claude.ai) | Guides you click by click and checks each step with you. It can read screenshots you paste to spot mistakes. **You do the clicking.** |
| **An AI connected to your n8n** (for example Claude Code or the Claude desktop app with an n8n connector) | **Does the technical part itself:** imports the workflows, runs Setup, fills in settings, runs the tests and checks the results. You only do the account steps and click **Review and decide**. |

To connect an AI to n8n, n8n has an MCP option in its **Settings** (the exact menu name can change between versions). Turn it on there, then add it as a connector in your AI app. If you're not sure, use the chat option. It works for everyone.

---

## How to start

1. Download this repo: on GitHub click **Code → Download ZIP**.
2. Open your AI and **upload the zip file**. If it can't take zip files, paste the link to this GitHub repo instead.
3. Copy the whole prompt below, paste it into the chat and press Enter.
4. Follow its instructions. It will tell you when it's your turn.

---

## The prompt (copy everything in the box)

```text
You are my installation assistant for the open-source project "AI Proposes, PM Decides":
seven n8n workflows that help a project manager. I have shared the repo with you
(zip file or GitHub link). Install it with me from start to finish.

HOW TO WORK WITH ME
- I am not technical. Use plain words, one step at a time, and wait for me to say
  "done" before the next step. After each step, tell me how to check that it worked.
- Read INSTALL.md in the repo first. It is the source of truth for the steps and
  for what I should see on screen. Follow its order.
- If you can act inside my n8n yourself (you have tools connected to my n8n), do the
  technical steps yourself and tell me what you did. If you cannot, guide me
  click by click instead.
- If something fails, ask me for the exact error text or a screenshot, then check the
  Troubleshooting table in INSTALL.md before guessing.

SAFETY RULES (never break these)
- Never ask me for any password, and never ask me to paste my Gemini API key or any
  other secret into this chat. I will paste the key directly into n8n myself.
- Never create accounts or accept terms for me. I do those myself.
- Never click "Review and decide" or approve anything for me. That decision is
  always mine.
- Never send emails to anyone except me. These workflows only save drafts for other
  people; keep it that way.

STEPS I MUST DO MYSELF (walk me through them, then check with me)
1. Create an n8n Cloud account at n8n.io (or tell you I already have n8n).
2. Create a free Gemini API key at aistudio.google.com.
3. In n8n, create two credentials: "Google Gemini(PaLM) Api" (I paste the key) and
   "Microsoft Outlook OAuth2 API" (I sign in with Microsoft).
4. Only if you can work inside my n8n: connect you to my n8n.

STEPS YOU DO (yourself if you have n8n tools, otherwise guide me)
5. Import 00-setup/workflow.json and run it. Check that 6 data tables starting with
   "pmd_" exist.
6. Import 04-intake-triage/workflow.json. Select my credentials on every node that
   needs one. In the "Settings" node, replace YOUR_EMAIL@example.com with the email
   address I give you.
7. Test it the way INSTALL.md Step 7 describes. Remind me to keep the workflow open
   in the editor during the test and to check my Junk folder. Wait while I click
   "Review and decide", then check that pmd_audit_log has a new row.
8. Repeat for: agent-team, 01-weekly-status-agent, 02-meeting-to-actions,
   03-stakeholder-translator, 05-retro-synthesizer, 06-daily-slip-alert, using the
   test table in INSTALL.md Step 8 and the sample files in each folder's sample-data.
9. Finally, explain how to Publish each workflow and where to find the form links
   (INSTALL.md Step 9).

Start now: greet me in one sentence, ask whether I already have an n8n account, and
tell me roughly how long this will take.
```

---

## What to expect

- **About 15 minutes of your time** for the account steps, then **20–40 minutes** for the rest, depending on whether the AI can act in n8n.
- **The first AI test can be slow** (up to several minutes) on a free Gemini key. That's the free tier's speed limit, not an error.
- **You will always click the final decision yourself.** That's the point of the project: AI proposes, the PM decides.

## Why the AI never sees your key or passwords

Your Gemini key and Microsoft sign-in give access to paid services and your email. Pasting them into any chat means they're stored in that chat's history. The prompt tells the AI never to ask for them. If an AI asks anyway, **don't share them**, and paste the key only into n8n's credential screen.
