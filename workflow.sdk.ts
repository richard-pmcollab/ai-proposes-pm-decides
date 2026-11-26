import { workflow, node, trigger, sticky, ifElse, languageModel, outputParser, expr } from '@n8n/workflow-sdk';

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

// ---------- Settings: the only node most people need to edit ----------
const settings = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Settings',
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'approver', name: 'approverEmail', value: 'YOUR_EMAIL@example.com', type: 'string' },
          { id: 'pause', name: 'pauseSeconds', value: 13, type: 'number' }
        ]
      }
    }
  }
});

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

// ---------- 3. Propose: orchestrator plans, specialists work one at a time, orchestrator reviews ----------
// FREE-TIER SAFE: one model call at a time with a pause between calls, so a run stays under
// Gemini's free limit of 5 requests per minute. Paid key? Set pauseSeconds to 0 in Settings.
const GEMINI = { googlePalmApi: { id: 'YOUR_GEMINI_CREDENTIAL_ID', name: 'Google Gemini' } };
const CONTEXT = '\n\nPROJECT CONTEXT PACK (the only facts you may use):\n{{ JSON.stringify($("Build Context Pack").first().json) }}';
const MODEL = 'models/gemini-3-flash-preview';
const PAUSE = { resume: 'timeInterval', amount: expr('{{ $("Settings").first().json.pauseSeconds }}'), unit: 'seconds' };

const planModel = languageModel({ type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', version: 1.2, config: { name: 'Gemini: Plan', parameters: { modelName: MODEL, options: { temperature: 0.1 } }, credentials: GEMINI } });
const statusModel = languageModel({ type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', version: 1.2, config: { name: 'Gemini: Status', parameters: { modelName: MODEL, options: { temperature: 0.2 } }, credentials: GEMINI } });
const scheduleModel = languageModel({ type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', version: 1.2, config: { name: 'Gemini: Schedule', parameters: { modelName: MODEL, options: { temperature: 0.1 } }, credentials: GEMINI } });
const raidModel = languageModel({ type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', version: 1.2, config: { name: 'Gemini: RAID', parameters: { modelName: MODEL, options: { temperature: 0.1 } }, credentials: GEMINI } });
const commsModel = languageModel({ type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', version: 1.2, config: { name: 'Gemini: Comms', parameters: { modelName: MODEL, options: { temperature: 0.3 } }, credentials: GEMINI } });
const reviewModel = languageModel({ type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', version: 1.2, config: { name: 'Gemini: Review', parameters: { modelName: MODEL, options: { temperature: 0.1 } }, credentials: GEMINI } });

const planParser = outputParser({ type: '@n8n/n8n-nodes-langchain.outputParserStructured', version: 1.3, config: { name: 'Plan Structure', parameters: { schemaType: 'fromJson', jsonSchemaExample: '{ "focus": "The one issue that matters most this week", "statusBrief": "What the Status specialist should emphasise", "scheduleBrief": "What the Schedule specialist should dig into", "raidBrief": "What the RAID specialist should look for", "commsBrief": "Audience, tone and the key message for the sponsor update" }' } } });
const raidParser = outputParser({ type: '@n8n/n8n-nodes-langchain.outputParserStructured', version: 1.3, config: { name: 'RAID Structure', parameters: { schemaType: 'fromJson', jsonSchemaExample: '{ "newRaidItems": [{ "raid_type": "Risk", "title": "Short title", "impact": "High", "likelihood": "Medium", "owner": "Name", "mitigation": "Concrete action" }], "updatesToExisting": ["Existing entry X should be raised to High impact because Y"] }' } } });
const commsParser = outputParser({ type: '@n8n/n8n-nodes-langchain.outputParserStructured', version: 1.3, config: { name: 'Comms Structure', parameters: { schemaType: 'fromJson', jsonSchemaExample: '{ "subject": "Subject line", "body": "Email body with short paragraphs" }' } } });
const reviewParser = outputParser({ type: '@n8n/n8n-nodes-langchain.outputParserStructured', version: 1.3, config: { name: 'Review Structure', parameters: { schemaType: 'fromJson', jsonSchemaExample: '{ "headline": "Project Atlas is Red: dry run slipped 7 days on a vendor block", "status": { "executiveSummary": "Two to three sentences.", "doneThisWeek": ["Item"], "nextWeek": ["Item"] }, "schedule": { "findings": ["Finding"], "recommendation": "One concrete recovery action" }, "decisionsNeeded": ["Decision for the sponsor"], "reviewNotes": "Any inconsistency you found between specialists, or empty" }' } } });

const orchestratorPlan = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm', version: 1.9,
  config: {
    name: 'Orchestrator: Plan',
    parameters: {
      promptType: 'define',
      text: expr('You are the ORCHESTRATOR of a PM agent team. You never write to any system; you plan the work and brief four specialists (Status, Schedule, RAID, Comms). Read the context pack, decide the single most important issue this week, and write a one-sentence brief for each specialist telling them what to focus on. The RAG in health.rag is set by rules and is final.' + CONTEXT),
      hasOutputParser: true
    },
    subnodes: { model: planModel, outputParser: planParser }
  }
});

const wait1 = node({ type: 'n8n-nodes-base.wait', version: 1.1, config: { name: 'Pace 1', parameters: PAUSE } });

const statusSpecialist = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm', version: 1.9,
  config: {
    name: 'Status Specialist',
    parameters: {
      promptType: 'define',
      text: expr('You are the STATUS specialist on a PM team. Orchestrator brief: {{ $("Orchestrator: Plan").first().json.output.statusBrief }}\n\nReturn three short sections in plain text: EXECUTIVE SUMMARY (2-3 sentences, lead with health.rag and the main issue), DONE (doneTasks plus positive teamNotes), NEXT WEEK (tasks in dueNext7Ids, critical first, with owners). health.rag is final. Never invent facts.' + CONTEXT)
    },
    subnodes: { model: statusModel }
  }
});

const wait2 = node({ type: 'n8n-nodes-base.wait', version: 1.1, config: { name: 'Pace 2', parameters: PAUSE } });

const scheduleSpecialist = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm', version: 1.9,
  config: {
    name: 'Schedule Specialist',
    parameters: {
      promptType: 'define',
      text: expr('You are the SCHEDULE specialist on a PM team. Orchestrator brief: {{ $("Orchestrator: Plan").first().json.output.scheduleBrief }}\n\nIn plain text: list each milestone with slipDays > 0 and its likely cause (link it to overdue or blocked task IDs), name any knock-on risk to later milestones, and give ONE concrete recovery recommendation. Be precise with numbers and dates. Never invent facts.' + CONTEXT)
    },
    subnodes: { model: scheduleModel }
  }
});

const wait3 = node({ type: 'n8n-nodes-base.wait', version: 1.1, config: { name: 'Pace 3', parameters: PAUSE } });

const raidSpecialist = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm', version: 1.9,
  config: {
    name: 'RAID Specialist',
    parameters: {
      promptType: 'define',
      text: expr('You are the RAID specialist on a PM team. Orchestrator brief: {{ $("Orchestrator: Plan").first().json.output.raidBrief }}\n\nCompare blocked tasks, overdue critical tasks, milestone slips and teamNotes against existingRaid. Propose ONLY genuinely new items (not a rewording of an existing entry), maximum 4. Each needs raid_type (Risk or Issue), title, impact (High/Medium/Low), likelihood (High/Medium/Low), owner (a person named in the data) and a concrete mitigation. Put suggested changes to existing entries in updatesToExisting. Never invent facts.' + CONTEXT),
      hasOutputParser: true
    },
    subnodes: { model: raidModel, outputParser: raidParser }
  }
});

const wait4 = node({ type: 'n8n-nodes-base.wait', version: 1.1, config: { name: 'Pace 4', parameters: PAUSE } });

const commsSpecialist = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm', version: 1.9,
  config: {
    name: 'Comms Specialist',
    parameters: {
      promptType: 'define',
      text: expr('You are the COMMS specialist on a PM team. Orchestrator brief: {{ $("Orchestrator: Plan").first().json.output.commsBrief }}\n\nFindings from the other specialists:\nSTATUS:\n{{ $("Status Specialist").first().json.text }}\n\nSCHEDULE:\n{{ $("Schedule Specialist").first().json.text }}\n\nNEW RAID ITEMS:\n{{ JSON.stringify($("RAID Specialist").first().json.output.newRaidItems) }}\n\nWrite the stakeholder update email for the project sponsor ({{ $("Build Context Pack").first().json.project.sponsor }}): a subject line and a body under 180 words covering status, the main issue, what the team is doing, and any decision needed from the sponsor. Professional and direct. No hype, no invented facts. Sign off as "The project team".')
      ,
      hasOutputParser: true
    },
    subnodes: { model: commsModel, outputParser: commsParser }
  }
});

const wait5 = node({ type: 'n8n-nodes-base.wait', version: 1.1, config: { name: 'Pace 5', parameters: PAUSE } });

const orchestratorReview = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm', version: 1.9,
  config: {
    name: 'Orchestrator: Review',
    parameters: {
      promptType: 'define',
      text: expr('You are the ORCHESTRATOR of a PM agent team. Your specialists have reported back. Check their work for consistency with the facts, then assemble the proposal pack for the PM. Use only what is below and in the context pack. The RAG ({{ $("Build Context Pack").first().json.health.rag }}) is final. decisionsNeeded: only items that need a sponsor or PM decision. If specialists contradict each other or the facts, say so in reviewNotes.\n\nYOUR FOCUS THIS WEEK: {{ $("Orchestrator: Plan").first().json.output.focus }}\n\nSTATUS SPECIALIST:\n{{ $("Status Specialist").first().json.text }}\n\nSCHEDULE SPECIALIST:\n{{ $("Schedule Specialist").first().json.text }}\n\nRAID SPECIALIST:\n{{ JSON.stringify($("RAID Specialist").first().json.output) }}\n\nCOMMS SPECIALIST:\n{{ JSON.stringify($("Comms Specialist").first().json.output) }}' + CONTEXT),
      hasOutputParser: true
    },
    subnodes: { model: reviewModel, outputParser: reviewParser }
  }
});

const proposalPack = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Proposal Pack',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `// RAID items and the stakeholder email come straight from the specialists,
// so the orchestrator's review cannot silently change what the PM approves.
const review = $('Orchestrator: Review').first().json.output;
const raid = $('RAID Specialist').first().json.output || {};
const comms = $('Comms Specialist').first().json.output || {};
return [{ json: { output: {
  headline: review.headline,
  status: review.status || { executiveSummary: '', doneThisWeek: [], nextWeek: [] },
  schedule: review.schedule || { findings: [], recommendation: '' },
  decisionsNeeded: review.decisionsNeeded || [],
  reviewNotes: review.reviewNotes || '',
  newRaidItems: raid.newRaidItems || [],
  updatesToExisting: raid.updatesToExisting || [],
  stakeholderUpdate: { subject: comms.subject || '', body: comms.body || '' }
} } }];`
    }
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
  + '<h3>Suggested changes to existing RAID entries (not applied automatically)</h3>' + ul(p.updatesToExisting)
  + '<h3>Decisions needed</h3>' + ul(p.decisionsNeeded)
  + (p.reviewNotes ? '<p><b>Orchestrator review notes:</b> ' + esc(p.reviewNotes) + '</p>' : '')
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
      toRecipients: expr('{{ $("Settings").first().json.approverEmail }}'),
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
      subject: expr('{{ $("Proposal Pack").first().json.output.stakeholderUpdate.subject }}'),
      bodyContent: expr('{{ $("Proposal Pack").first().json.output.stakeholderUpdate.body }}'),
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
          specialist: 'Orchestrator + Status, Schedule, RAID, Comms',
          proposal: expr('{{ $("Proposal Pack").first().json.output.headline }}'),
          decision: 'Approved',
          decided_by: 'PM',
          write_back: expr('Stakeholder draft saved; {{ ($("Proposal Pack").first().json.output.newRaidItems || []).length }} RAID item(s) added')
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
      jsCode: `const items = $('Proposal Pack').first().json.output.newRaidItems || [];
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
          specialist: 'Orchestrator + Status, Schedule, RAID, Comms',
          proposal: expr('{{ $("Proposal Pack").first().json.output.headline }}'),
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
The **orchestrator** plans the week and briefs four **specialists** (Status, Schedule, RAID, Comms), then reviews their work and builds one **proposal pack**. The PM gets an email with **Approve / Reject**. Nothing is written until the PM approves, and every decision is logged.

**Free-tier safe:** one AI call at a time with a short pause (Settings → pauseSeconds). Paid key? Set it to 0.

**Flow:** Sense → Analyse → Propose → **PM approves** → Act → Log`, [settings, loadTracker, readRaid, contextPack], { color: 5 });

export default workflow('ai-proposes-pm-decides', 'AI Proposes, PM Decides: PM Agent Team v1.1')
  .add(weeklySchedule)
  .to(settings)
  .to(loadTracker)
  .to(readRaid)
  .to(contextPack)
  .to(orchestratorPlan)
  .to(wait1)
  .to(statusSpecialist)
  .to(wait2)
  .to(scheduleSpecialist)
  .to(wait3)
  .to(raidSpecialist)
  .to(wait4)
  .to(commsSpecialist)
  .to(wait5)
  .to(orchestratorReview)
  .to(proposalPack)
  .to(formatApproval)
  .to(approvalGate)
  .to(isApproved
    .onTrue(commsDraft.to(logApproved.to(splitRaid.to(insertRaid))))
    .onFalse(logRejected))
  .add(testRun)
  .to(settings)
  .add(note)
  .group('Sense and analyse', [settings, loadTracker, readRaid, contextPack], { description: 'Settings, read-only connectors, field filter and rule-based health. The AI never decides the RAG.' })
  .group('Propose', [orchestratorPlan, planModel, planParser, wait1, statusSpecialist, statusModel, wait2, scheduleSpecialist, scheduleModel, wait3, raidSpecialist, raidModel, raidParser, wait4, commsSpecialist, commsModel, commsParser, wait5, orchestratorReview, reviewModel, reviewParser, proposalPack, formatApproval], { description: 'Orchestrator plans, four specialists work one at a time (free-tier safe), orchestrator reviews' })
  .group('PM decides', [approvalGate, isApproved], { description: 'Approve or reject by email. Nothing is written anywhere before this point.' })
  .group('Act and log', [commsDraft, logApproved, splitRaid, insertRaid], { description: 'Only after approval: save the update as a draft, add RAID items, log the decision' });
