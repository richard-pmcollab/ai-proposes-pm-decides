import { workflow, node, trigger, sticky, ifElse, languageModel, outputParser, tool, fromAi, expr } from '@n8n/workflow-sdk';

// ---------- Triggers ----------
const weeklySchedule = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.4,
  config: {
    name: 'Every Friday 8 AM',
    parameters: { rule: { interval: [{ field: 'weeks', weeksInterval: 1, triggerAtDay: [5], triggerAtHour: 8, triggerAtMinute: 0 }] } }
  }
});

const testRun = trigger({ type: 'n8n-nodes-base.manualTrigger', version: 1, config: { name: 'Test Run' } });

// ---------- 1. Sense: read-only connectors ----------
const loadTracker = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Read Project Tracker',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `// READ-ONLY CONNECTOR. Fictional sample project.
// Swap this node for Jira, Asana, Monday.com, Excel or Google Sheets and keep the same fields.
const today = new Date();
today.setHours(0, 0, 0, 0);
const d = (n) => { const x = new Date(today); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

return [{ json: {
  reportDate: d(0),
  project: { name: 'Project Atlas: CRM Migration', sponsor: 'VP Sales Operations', phase: 'Build', budgetPlanned: 250000, budgetSpent: 171000, goLive: d(47) },
  tasks: [
    { id: 'T-101', task: 'Data mapping sign-off', owner: 'A. Chen', due: d(-9), progress: 100, status: 'Done', critical: true },
    { id: 'T-102', task: 'Legacy data cleanse (accounts)', owner: 'M. Okafor', due: d(-3), progress: 80, status: 'In Progress', critical: true },
    { id: 'T-103', task: 'Legacy data cleanse (contacts)', owner: 'M. Okafor', due: d(4), progress: 45, status: 'In Progress', critical: true },
    { id: 'T-104', task: 'API integration with billing system', owner: 'R. Patel', due: d(2), progress: 60, status: 'Blocked', critical: true, blocker: 'Waiting on billing vendor sandbox credentials' },
    { id: 'T-105', task: 'Sales pipeline configuration', owner: 'J. Tremblay', due: d(-5), progress: 100, status: 'Done', critical: false },
    { id: 'T-106', task: 'Role and permission setup', owner: 'J. Tremblay', due: d(6), progress: 70, status: 'In Progress', critical: false },
    { id: 'T-107', task: 'UAT test scripts', owner: 'S. Nguyen', due: d(10), progress: 30, status: 'In Progress', critical: false },
    { id: 'T-108', task: 'Training plan for 120 sales reps', owner: 'L. Martin', due: d(14), progress: 20, status: 'In Progress', critical: false },
    { id: 'T-109', task: 'Reporting dashboards', owner: 'A. Chen', due: d(-1), progress: 100, status: 'Done', critical: false }
  ],
  milestones: [
    { name: 'Data migration dry run', baseline: d(5), forecast: d(12) },
    { name: 'UAT start', baseline: d(19), forecast: d(21) },
    { name: 'Go-live', baseline: d(47), forecast: d(47) }
  ],
  teamNotes: [
    'Billing vendor says sandbox credentials will arrive early next week, no firm date.',
    'Two UAT testers are shared with the Q4 audit and may be unavailable for 5 days.',
    'Sales leadership asked for a training demo before go-live.',
    'Reporting dashboards finished a day early.'
  ]
} }];`
    }
  }
});

const readRaid = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Read RAID Log',
    alwaysOutputData: true,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'name', value: 'pmd_raid_log' },
      returnAll: true
    }
  }
});

// ---------- 2. Analyse: field filter + rule-based health ----------
const contextPack = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Context Pack',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `// FIELD FILTER: agents only see what they need.
// RAG is set by fixed rules here, never by the AI.
const t = $('Read Project Tracker').first().json;
const raid = $input.all().map(i => i.json).filter(r => r && r.title)
  .map(r => ({ type: r.raid_type, title: r.title, impact: r.impact, likelihood: r.likelihood, owner: r.owner, status: r.status }));

const today = new Date(t.reportDate);
const DAY = 86400000;
const open = t.tasks.filter(x => x.status !== 'Done');
const done = t.tasks.filter(x => x.status === 'Done');
const overdue = open.filter(x => new Date(x.due) < today);
const blocked = open.filter(x => x.status === 'Blocked');
const criticalOverdue = overdue.filter(x => x.critical);
const dueNext7 = open.filter(x => { const n = (new Date(x.due) - today) / DAY; return n >= 0 && n <= 7; });
const percentComplete = Math.round(t.tasks.reduce((s, x) => s + x.progress, 0) / t.tasks.length);
const budgetUsedPct = Math.round((t.project.budgetSpent / t.project.budgetPlanned) * 100);
const milestones = t.milestones.map(m => ({ ...m, slipDays: Math.round((new Date(m.forecast) - new Date(m.baseline)) / DAY) }));
const maxSlip = Math.max(0, ...milestones.map(m => m.slipDays));

const reasons = [];
if (maxSlip > 0) reasons.push('Milestone slip of up to ' + maxSlip + ' days');
if (criticalOverdue.length) reasons.push(criticalOverdue.length + ' critical task(s) overdue');
if (overdue.length > criticalOverdue.length) reasons.push((overdue.length - criticalOverdue.length) + ' non-critical task(s) overdue');
if (blocked.length) reasons.push(blocked.length + ' task(s) blocked');
if (budgetUsedPct - percentComplete > 10) reasons.push('Budget burn ahead of progress');

let rag = 'Green';
if (maxSlip > 5 || criticalOverdue.length >= 2) rag = 'Red';
else if (reasons.length) rag = 'Amber';

return [{ json: {
  reportDate: t.reportDate,
  project: { name: t.project.name, sponsor: t.project.sponsor, phase: t.project.phase, goLive: t.project.goLive },
  health: { rag, ragReasons: reasons.length ? reasons : ['On track'], percentComplete, budgetUsedPct, tasksDone: done.length, tasksOpen: open.length },
  milestones,
  doneTasks: done.map(x => ({ id: x.id, task: x.task, owner: x.owner })),
  openTasks: open.map(x => ({ id: x.id, task: x.task, owner: x.owner, due: x.due, progress: x.progress, status: x.status, critical: x.critical, blocker: x.blocker || null })),
  overdueIds: overdue.map(x => x.id),
  dueNext7Ids: dueNext7.map(x => x.id),
  teamNotes: t.teamNotes,
  existingRaid: raid
} }];`
    }
  }
});

// ---------- 3. Propose: orchestrator + specialists ----------
const GEMINI = { googlePalmApi: { id: 'YOUR_GEMINI_CREDENTIAL_ID', name: 'Google Gemini' } };
const CONTEXT = '\n\nPROJECT CONTEXT PACK (facts you may use):\n{{ JSON.stringify($("Build Context Pack").first().json) }}';

const orchestratorModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', version: 1.2,
  config: { name: 'Gemini: Orchestrator', parameters: { modelName: 'models/gemini-3-flash-preview', options: { temperature: 0.1 } }, credentials: GEMINI }
});
const statusModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', version: 1.2,
  config: { name: 'Gemini: Status', parameters: { modelName: 'models/gemini-3-flash-preview', options: { temperature: 0.2 } }, credentials: GEMINI }
});
const scheduleModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', version: 1.2,
  config: { name: 'Gemini: Schedule', parameters: { modelName: 'models/gemini-3-flash-preview', options: { temperature: 0.1 } }, credentials: GEMINI }
});
const raidModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', version: 1.2,
  config: { name: 'Gemini: RAID', parameters: { modelName: 'models/gemini-3-flash-preview', options: { temperature: 0.1 } }, credentials: GEMINI }
});
const commsModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', version: 1.2,
  config: { name: 'Gemini: Comms', parameters: { modelName: 'models/gemini-3-flash-preview', options: { temperature: 0.3 } }, credentials: GEMINI }
});

const statusAgent = tool({
  type: '@n8n/n8n-nodes-langchain.agentTool', version: 3,
  config: {
    name: 'Status Specialist',
    parameters: {
      toolDescription: 'Builds the weekly status summary: executive summary, done this week, next week. Call once.',
      text: expr('{{ $fromAI("instruction", "What the orchestrator needs from the status specialist", "string") }}' + CONTEXT),
      options: { systemMessage: 'You are the Status specialist on a PM team. Using ONLY the context pack, return: (1) a 2-3 sentence executive summary that leads with health.rag and the most important issue, (2) a list of what was done (doneTasks + positive teamNotes), (3) a list of next-week priorities from tasks in dueNext7Ids, critical first. health.rag is final: never change it. Never invent facts. Plain, direct language.' }
    },
    subnodes: { model: statusModel }
  }
});

const scheduleAgent = tool({
  type: '@n8n/n8n-nodes-langchain.agentTool', version: 3,
  config: {
    name: 'Schedule Specialist',
    parameters: {
      toolDescription: 'Analyses schedule slippage: milestone slips, overdue and blocked critical-path work, knock-on effects. Call once.',
      text: expr('{{ $fromAI("instruction", "What the orchestrator needs from the schedule specialist", "string") }}' + CONTEXT),
      options: { systemMessage: 'You are the Schedule specialist on a PM team. Using ONLY the context pack: list each milestone with slipDays > 0 and its likely cause (link to overdue or blocked tasks), name any knock-on risk to later milestones, and give ONE concrete recovery recommendation. Be precise with numbers and dates. Never invent facts.' }
    },
    subnodes: { model: scheduleModel }
  }
});

const raidAgent = tool({
  type: '@n8n/n8n-nodes-langchain.agentTool', version: 3,
  config: {
    name: 'RAID Specialist',
    parameters: {
      toolDescription: 'Finds NEW risks and issues that are not yet in the RAID log, with impact, likelihood, owner and mitigation. Call once.',
      text: expr('{{ $fromAI("instruction", "What the orchestrator needs from the RAID specialist", "string") }}' + CONTEXT),
      options: { systemMessage: 'You are the RAID specialist on a PM team. Compare blocked tasks, overdue critical tasks, milestone slips and teamNotes against existingRaid. Propose ONLY items that are genuinely new (not a rewording of an existing entry). For each: raid_type (Risk or Issue), title, impact (High/Medium/Low), likelihood (High/Medium/Low), owner (a person from the data), mitigation (concrete action). If an existing entry needs updating, say so separately. Never invent facts. Maximum 4 new items.' }
    },
    subnodes: { model: raidModel }
  }
});

const commsAgent = tool({
  type: '@n8n/n8n-nodes-langchain.agentTool', version: 3,
  config: {
    name: 'Comms Specialist',
    parameters: {
      toolDescription: 'Drafts the stakeholder update email for the sponsor. Call LAST and pass it the key findings from the other specialists.',
      text: expr('{{ $fromAI("instruction", "Key findings from the other specialists and who the update is for", "string") }}' + CONTEXT),
      options: { systemMessage: 'You are the Comms specialist on a PM team. Write a short stakeholder update email for the project sponsor: a subject line, then a body under 180 words with the status, the main issue, what the team is doing about it, and any decision needed from the sponsor. Professional, direct, no hype, no invented facts. Plain text with short paragraphs.' }
    },
    subnodes: { model: commsModel }
  }
});

const packParser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured', version: 1.3,
  config: {
    name: 'Proposal Pack Structure',
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{ "headline": "Project Atlas is Red: dry run slipped 7 days on a vendor block", "status": { "executiveSummary": "Two to three sentences.", "doneThisWeek": ["Item"], "nextWeek": ["Item"] }, "schedule": { "findings": ["Data migration dry run +7 days, caused by blocked T-104"], "recommendation": "One concrete recovery action" }, "newRaidItems": [{ "raid_type": "Risk", "title": "Short title", "impact": "High", "likelihood": "Medium", "owner": "Name", "mitigation": "Concrete action" }], "stakeholderUpdate": { "subject": "Subject line", "body": "Email body" }, "decisionsNeeded": ["Decision for the sponsor"] }'
    }
  }
});

const orchestrator = node({
  type: '@n8n/n8n-nodes-langchain.agent', version: 3.1,
  config: {
    name: 'Orchestrator Agent',
    parameters: {
      promptType: 'define',
      text: expr('Run this week\'s PM review for {{ $json.project.name }} (health: {{ $json.health.rag }}; reasons: {{ $json.health.ragReasons.join("; ") }}). Call each specialist, then return the proposal pack.'),
      hasOutputParser: true,
      options: {
        maxIterations: 12,
        systemMessage: `You are the Orchestrator of a PM agent team. You plan and route work. You NEVER write to any system and you never make the final decision: everything you produce is a PROPOSAL for the PM to approve or reject.

Your specialists (tools):
- Status Specialist: executive summary, done, next week
- Schedule Specialist: slippage analysis and one recovery recommendation
- RAID Specialist: genuinely new risks and issues
- Comms Specialist: stakeholder update email. Call it LAST and pass it the key findings from the others.

Process: call Status, Schedule and RAID once each, then Comms once. Then assemble the proposal pack.

Rules:
- Use only what the specialists return. Do not add facts.
- The RAG status is set by rules and is final. Do not change it.
- decisionsNeeded: only items that need a sponsor or PM decision.
- If a specialist returns nothing useful, leave that section empty rather than guessing.`
      }
    },
    subnodes: { model: orchestratorModel, tools: [statusAgent, scheduleAgent, raidAgent, commsAgent], outputParser: packParser }
  }
});

// ---------- 4. PM approves ----------
const formatApproval = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Format Proposal for PM',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const p = $input.first().json.output;
const c = $('Build Context Pack').first().json;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ul = (a) => a && a.length ? '<ul>' + a.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '<p><em>None</em></p>';
const colors = { Green: '#1e7e34', Amber: '#b26a00', Red: '#b00020' };
const td = 'style="border:1px solid #ddd;padding:5px 8px;text-align:left;vertical-align:top"';
const raid = p.newRaidItems && p.newRaidItems.length
  ? '<table style="border-collapse:collapse;font-size:13px"><tr><th ' + td + '>Type</th><th ' + td + '>Title</th><th ' + td + '>Impact</th><th ' + td + '>Likelihood</th><th ' + td + '>Owner</th><th ' + td + '>Mitigation</th></tr>'
    + p.newRaidItems.map(r => '<tr><td ' + td + '>' + esc(r.raid_type) + '</td><td ' + td + '>' + esc(r.title) + '</td><td ' + td + '>' + esc(r.impact) + '</td><td ' + td + '>' + esc(r.likelihood) + '</td><td ' + td + '>' + esc(r.owner) + '</td><td ' + td + '>' + esc(r.mitigation) + '</td></tr>').join('') + '</table>'
  : '<p><em>No new items</em></p>';

const html = '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222;max-width:760px">'
  + '<p style="font-size:12px;letter-spacing:1px;color:#b00020;margin:0">AI PROPOSES · YOU DECIDE</p>'
  + '<h2 style="margin:4px 0">' + esc(p.headline) + '</h2>'
  + '<p><span style="background:' + colors[c.health.rag] + ';color:#fff;padding:3px 10px;border-radius:10px;font-weight:600">' + c.health.rag.toUpperCase() + '</span>&nbsp; ' + c.health.percentComplete + '% complete · ' + c.health.budgetUsedPct + '% budget used · rule reasons: ' + c.health.ragReasons.map(esc).join('; ') + '</p>'
  + '<h3>1 · Status</h3><p>' + esc(p.status.executiveSummary) + '</p><b>Done</b>' + ul(p.status.doneThisWeek) + '<b>Next week</b>' + ul(p.status.nextWeek)
  + '<h3>2 · Schedule</h3>' + ul(p.schedule.findings) + '<p><b>Recommendation:</b> ' + esc(p.schedule.recommendation) + '</p>'
  + '<h3>3 · New RAID items (will be added to the RAID log if you approve)</h3>' + raid
  + '<h3>4 · Stakeholder update (will be saved as an Outlook draft if you approve)</h3>'
  + '<div style="border-left:3px solid #ccc;padding:6px 12px;background:#fafafa"><b>' + esc(p.stakeholderUpdate.subject) + '</b><br>' + esc(p.stakeholderUpdate.body).replace(/\\n/g, '<br>') + '</div>'
  + '<h3>Decisions needed</h3>' + ul(p.decisionsNeeded)
  + '<p style="font-size:12px;color:#666">Nothing has been written to any system yet. Approve to apply the RAID items and save the update as a draft. Reject to discard. Either way, your decision is logged.</p>'
  + '</div>';

return [{ json: { subject: '[Approval needed] ' + p.headline, html } }];`
    }
  }
});

const approvalGate = node({
  type: 'n8n-nodes-base.microsoftOutlook', version: 2,
  config: {
    name: 'PM Approval Gate',
    parameters: {
      resource: 'message',
      operation: 'sendAndWait',
      toRecipients: 'YOUR_EMAIL@example.com',
      subject: expr('{{ $json.subject }}'),
      message: expr('{{ $json.html }}'),
      responseType: 'approval',
      approvalOptions: { values: { approvalType: 'double', approveLabel: 'Approve and apply', disapproveLabel: 'Reject' } },
      options: { limitWaitTime: { values: { limitType: 'afterTimeInterval', resumeAmount: 2, resumeUnit: 'days' } }, appendAttribution: false }
    },
    credentials: { microsoftOutlookOAuth2Api: { id: 'YOUR_OUTLOOK_CREDENTIAL_ID', name: 'Microsoft Outlook' } }
  }
});

const isApproved = ifElse({
  version: 2.2,
  config: {
    name: 'Approved?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.data.approved }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    }
  }
});

// ---------- 5. Act (only after approval) + 6. Log ----------
const commsDraft = node({
  type: 'n8n-nodes-base.microsoftOutlook', version: 2,
  config: {
    name: 'Write-back: Save Update as Draft',
    parameters: {
      resource: 'draft',
      operation: 'create',
      subject: expr('{{ $("Orchestrator Agent").first().json.output.stakeholderUpdate.subject }}'),
      bodyContent: expr('{{ $("Orchestrator Agent").first().json.output.stakeholderUpdate.body }}'),
      additionalFields: { bodyContentType: 'Text' }
    },
    credentials: { microsoftOutlookOAuth2Api: { id: 'YOUR_OUTLOOK_CREDENTIAL_ID', name: 'Microsoft Outlook' } }
  }
});

const AUDIT_SCHEMA = [
  { id: 'run_id', displayName: 'run_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'specialist', displayName: 'specialist', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'proposal', displayName: 'proposal', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'decision', displayName: 'decision', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'decided_by', displayName: 'decided_by', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'write_back', displayName: 'write_back', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }
];

const logApproved = node({
  type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: {
    name: 'Log Approval',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'name', value: 'pmd_audit_log' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          run_id: expr('{{ $execution.id }}'),
          specialist: 'Orchestrator (Status, Schedule, RAID, Comms)',
          proposal: expr('{{ $("Orchestrator Agent").first().json.output.headline }}'),
          decision: 'Approved',
          decided_by: 'PM',
          write_back: expr('Stakeholder draft saved; {{ ($("Orchestrator Agent").first().json.output.newRaidItems || []).length }} RAID item(s) added')
        },
        schema: AUDIT_SCHEMA
      }
    }
  }
});

const splitRaid = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Split New RAID Items',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const items = $('Orchestrator Agent').first().json.output.newRaidItems || [];
return items.map(r => ({ json: { raid_type: r.raid_type, title: r.title, impact: r.impact, likelihood: r.likelihood, owner: r.owner, mitigation: r.mitigation, status: 'Open', source: 'Agent run ' + $execution.id + ' (PM approved)' } }));`
    }
  }
});

const RAID_SCHEMA = [
  { id: 'raid_type', displayName: 'raid_type', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'title', displayName: 'title', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'impact', displayName: 'impact', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'likelihood', displayName: 'likelihood', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'owner', displayName: 'owner', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'mitigation', displayName: 'mitigation', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
  { id: 'source', displayName: 'source', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }
];

const insertRaid = node({
  type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: {
    name: 'Write-back: Add to RAID Log',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'name', value: 'pmd_raid_log' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          raid_type: expr('{{ $json.raid_type }}'), title: expr('{{ $json.title }}'), impact: expr('{{ $json.impact }}'),
          likelihood: expr('{{ $json.likelihood }}'), owner: expr('{{ $json.owner }}'), mitigation: expr('{{ $json.mitigation }}'),
          status: expr('{{ $json.status }}'), source: expr('{{ $json.source }}')
        },
        schema: RAID_SCHEMA
      }
    }
  }
});

const logRejected = node({
  type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: {
    name: 'Log Rejection',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: { __rl: true, mode: 'name', value: 'pmd_audit_log' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          run_id: expr('{{ $execution.id }}'),
          specialist: 'Orchestrator (Status, Schedule, RAID, Comms)',
          proposal: expr('{{ $("Orchestrator Agent").first().json.output.headline }}'),
          decision: 'Rejected (or no response in 2 days)',
          decided_by: 'PM',
          write_back: 'None'
        },
        schema: AUDIT_SCHEMA
      }
    }
  }
});

const note = sticky(`## AI proposes. The PM decides.
An orchestrator agent routes work to four specialists (Status, Schedule, RAID, Comms) and assembles a **proposal pack**. The PM gets an email with **Approve / Reject**. Nothing is written to any system until the PM approves, and every decision is logged.

**Flow:** Sense → Analyse → Propose → **PM approves** → Act → Log

**Guardrails:** read-only connectors · field filter · rule-based RAG (AI can't change it) · write-back only after approval · audit log`, [loadTracker, readRaid, contextPack], { color: 5 });

export default workflow('ai-proposes-pm-decides', 'AI Proposes, PM Decides: PM Agent Team v1')
  .add(weeklySchedule)
  .to(loadTracker)
  .to(readRaid)
  .to(contextPack)
  .to(orchestrator)
  .to(formatApproval)
  .to(approvalGate)
  .to(isApproved
    .onTrue(commsDraft.to(logApproved.to(splitRaid.to(insertRaid))))
    .onFalse(logRejected))
  .add(testRun)
  .to(loadTracker)
  .add(note)
  .group('Sense and analyse', [loadTracker, readRaid, contextPack], { description: 'Read-only connectors, field filter and rule-based health. The AI never decides the RAG.' })
  .group('Propose', [orchestrator, orchestratorModel, packParser, statusAgent, statusModel, scheduleAgent, scheduleModel, raidAgent, raidModel, commsAgent, commsModel, formatApproval], { description: 'Orchestrator routes to Status, Schedule, RAID and Comms specialists and builds one proposal pack' })
  .group('PM decides', [approvalGate, isApproved], { description: 'Approve or reject by email. Nothing is written anywhere before this point.' })
  .group('Act and log', [commsDraft, logApproved, splitRaid, insertRaid], { description: 'Only after approval: save the update as a draft, add RAID items, log the decision' });
