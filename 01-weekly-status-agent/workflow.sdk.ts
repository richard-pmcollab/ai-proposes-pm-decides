import { workflow, node, trigger, sticky, languageModel, outputParser, expr } from '@n8n/workflow-sdk';

const weeklySchedule = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.4,
  config: {
    name: 'Every Friday 8 AM',
    parameters: {
      rule: { interval: [{ field: 'weeks', weeksInterval: 1, triggerAtDay: [5], triggerAtHour: 8, triggerAtMinute: 0 }] }
    }
  }
});

const testRun = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Test Run' }
});

const loadTracker = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Load Project Tracker (Sample)',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `// Fictional sample project. Replace this node with your real tracker
// (Excel on OneDrive, Google Sheets, Jira, Asana) and keep the same fields.
// Dates are relative to today so the sample always looks current.
const today = new Date();
today.setHours(0, 0, 0, 0);
const d = (n) => { const x = new Date(today); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

const project = {
  name: 'Project Atlas: CRM Migration',
  sponsor: 'VP Sales Operations',
  phase: 'Build',
  budgetPlanned: 250000,
  budgetSpent: 171000,
  goLive: d(47)
};

const tasks = [
  { id: 'T-101', task: 'Data mapping sign-off', owner: 'A. Chen', workstream: 'Data', due: d(-9), progress: 100, status: 'Done', critical: true },
  { id: 'T-102', task: 'Legacy data cleanse (accounts)', owner: 'M. Okafor', workstream: 'Data', due: d(-3), progress: 80, status: 'In Progress', critical: true },
  { id: 'T-103', task: 'Legacy data cleanse (contacts)', owner: 'M. Okafor', workstream: 'Data', due: d(4), progress: 45, status: 'In Progress', critical: true },
  { id: 'T-104', task: 'API integration with billing system', owner: 'R. Patel', workstream: 'Integration', due: d(2), progress: 60, status: 'Blocked', critical: true, blocker: 'Waiting on billing vendor sandbox credentials' },
  { id: 'T-105', task: 'Sales pipeline configuration', owner: 'J. Tremblay', workstream: 'Config', due: d(-5), progress: 100, status: 'Done', critical: false },
  { id: 'T-106', task: 'Role and permission setup', owner: 'J. Tremblay', workstream: 'Config', due: d(6), progress: 70, status: 'In Progress', critical: false },
  { id: 'T-107', task: 'UAT test scripts', owner: 'S. Nguyen', workstream: 'Testing', due: d(10), progress: 30, status: 'In Progress', critical: false },
  { id: 'T-108', task: 'Training plan for 120 sales reps', owner: 'L. Martin', workstream: 'Change', due: d(14), progress: 20, status: 'In Progress', critical: false },
  { id: 'T-109', task: 'Reporting dashboards', owner: 'A. Chen', workstream: 'Config', due: d(-1), progress: 100, status: 'Done', critical: false }
];

const milestones = [
  { name: 'Data migration dry run', baseline: d(5), forecast: d(12) },
  { name: 'UAT start', baseline: d(19), forecast: d(21) },
  { name: 'Go-live', baseline: d(47), forecast: d(47) }
];

const teamNotes = [
  'Billing vendor says sandbox credentials will arrive early next week, no firm date.',
  'Two UAT testers are shared with the Q4 audit and may be unavailable for 5 days.',
  'Sales leadership asked for a training demo before go-live.',
  'Reporting dashboards finished a day early.'
];

return [{ json: { reportDate: d(0), project, tasks, milestones, teamNotes } }];`
    }
  }
});

const calcHealth = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Calculate Health and RAG',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `// RAG status is set by fixed rules here, NOT by the AI.
// The rules are visible and auditable; the AI only writes the narrative.
const data = $input.first().json;
const today = new Date(data.reportDate);
const DAY = 86400000;

const open = data.tasks.filter(t => t.status !== 'Done');
const done = data.tasks.filter(t => t.status === 'Done');
const overdue = open.filter(t => new Date(t.due) < today);
const blocked = open.filter(t => t.status === 'Blocked');
const dueNext7 = open.filter(t => { const days = (new Date(t.due) - today) / DAY; return days >= 0 && days <= 7; });
const criticalOverdue = overdue.filter(t => t.critical);

const percentComplete = Math.round(data.tasks.reduce((s, t) => s + t.progress, 0) / data.tasks.length);
const budgetUsedPct = Math.round((data.project.budgetSpent / data.project.budgetPlanned) * 100);

const milestones = data.milestones.map(m => ({ ...m, slipDays: Math.round((new Date(m.forecast) - new Date(m.baseline)) / DAY) }));
const maxSlip = Math.max(0, ...milestones.map(m => m.slipDays));

const reasons = [];
if (maxSlip > 0) reasons.push('Milestone slip of up to ' + maxSlip + ' days');
if (criticalOverdue.length) reasons.push(criticalOverdue.length + ' critical task(s) overdue');
if (overdue.length > criticalOverdue.length) reasons.push((overdue.length - criticalOverdue.length) + ' non-critical task(s) overdue');
if (blocked.length) reasons.push(blocked.length + ' task(s) blocked');
if (budgetUsedPct - percentComplete > 10) reasons.push('Budget burn (' + budgetUsedPct + '%) ahead of progress (' + percentComplete + '%)');

let rag = 'Green';
if (maxSlip > 5 || criticalOverdue.length >= 2) rag = 'Red';
else if (reasons.length) rag = 'Amber';

return [{ json: {
  ...data,
  metrics: {
    rag,
    ragReasons: reasons.length ? reasons : ['On track: no slips, overdue or blocked work'],
    percentComplete,
    budgetUsedPct,
    tasksDone: done.length,
    tasksOpen: open.length,
    overdue: overdue.map(t => ({ id: t.id, task: t.task, owner: t.owner, due: t.due, critical: t.critical })),
    blocked: blocked.map(t => ({ id: t.id, task: t.task, owner: t.owner, blocker: t.blocker })),
    dueNext7: dueNext7.map(t => ({ id: t.id, task: t.task, owner: t.owner, due: t.due })),
    milestones
  }
} }];`
    }
  }
});

const geminiModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini',
  version: 1.2,
  config: {
    name: 'Gemini Model',
    parameters: { modelName: 'models/gemini-3-flash-preview', options: { temperature: 0.2 } },
    credentials: { googlePalmApi: { id: 'YOUR_GEMINI_CREDENTIAL_ID', name: 'Google Gemini' } }
  }
});

const reportParser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Report Structure',
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{ "subject": "Project Atlas | Weekly Status | Amber", "executiveSummary": "Two or three sentences for an executive.", "accomplishments": ["Finished X"], "nextWeek": ["Complete Y"], "risks": [{ "risk": "Vendor delay on sandbox", "impact": "Dry run slips 7 days", "mitigation": "Escalate to vendor account manager", "owner": "R. Patel" }], "decisionsNeeded": ["Approve backfill tester for 5 days"] }'
    }
  }
});

const draftReport = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Draft Status Report',
    parameters: {
      promptType: 'define',
      text: expr('Write this week\'s status report from the project data below.\n\n{{ JSON.stringify($json, null, 2) }}'),
      hasOutputParser: true,
      options: {
        systemMessage: `You are a senior program manager's reporting assistant. You draft the weekly status report that the PM reviews before sending.

Rules:
- Use ONLY facts in the data. Never invent tasks, dates, names or numbers.
- The RAG status in metrics.rag is final. Do not change it or argue with it. Explain it using metrics.ragReasons.
- Executive summary: 2-3 plain sentences. Lead with the RAG and the single most important issue.
- Accomplishments: tasks with status Done, plus positive items from teamNotes.
- Next week: open tasks from metrics.dueNext7, most critical first.
- Risks: build from blocked tasks, overdue critical tasks, milestone slips and teamNotes. Each risk needs impact, a concrete mitigation and an owner from the data.
- Decisions needed: only items that need a sponsor or leadership decision. Empty list if none.
- Subject format: "<project name> | Weekly Status | <RAG>".
- Tone: direct and factual. Red means red. No filler or hype.`
      }
    },
    subnodes: { model: geminiModel, outputParser: reportParser }
  }
});

const formatEmail = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Format Email',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const r = $input.first().json.output;
const src = $('Calculate Health and RAG').first().json;
const m = src.metrics;
const colors = { Green: '#1e7e34', Amber: '#b26a00', Red: '#b00020' };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const list = (items) => items && items.length ? '<ul>' + items.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>' : '<p><em>None</em></p>';
const cell = 'style="border:1px solid #ddd;padding:6px 10px;text-align:left"';

const risks = r.risks && r.risks.length
  ? '<table style="border-collapse:collapse;font-size:14px"><tr><th ' + cell + '>Risk</th><th ' + cell + '>Impact</th><th ' + cell + '>Mitigation</th><th ' + cell + '>Owner</th></tr>'
    + r.risks.map(x => '<tr><td ' + cell + '>' + esc(x.risk) + '</td><td ' + cell + '>' + esc(x.impact) + '</td><td ' + cell + '>' + esc(x.mitigation) + '</td><td ' + cell + '>' + esc(x.owner) + '</td></tr>').join('')
    + '</table>'
  : '<p><em>None</em></p>';

const milestones = '<table style="border-collapse:collapse;font-size:14px"><tr><th ' + cell + '>Milestone</th><th ' + cell + '>Baseline</th><th ' + cell + '>Forecast</th><th ' + cell + '>Slip</th></tr>'
  + m.milestones.map(x => '<tr><td ' + cell + '>' + esc(x.name) + '</td><td ' + cell + '>' + x.baseline + '</td><td ' + cell + '>' + x.forecast + '</td><td ' + cell + '>' + (x.slipDays > 0 ? '+' + x.slipDays + ' days' : 'On time') + '</td></tr>').join('')
  + '</table>';

const html = '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222;max-width:720px">'
  + '<p style="background:#fff8e1;border-left:4px solid #b26a00;padding:8px 12px;font-size:12px">DRAFT generated by the Weekly Status Agent. Review and edit before sending.</p>'
  + '<h2 style="margin-bottom:4px">' + esc(src.project.name) + '</h2>'
  + '<p style="margin-top:0;color:#555">Week ending ' + src.reportDate + ' · Phase: ' + esc(src.project.phase) + ' · Sponsor: ' + esc(src.project.sponsor) + '</p>'
  + '<p><span style="background:' + colors[m.rag] + ';color:#fff;padding:4px 12px;border-radius:12px;font-weight:600">' + m.rag.toUpperCase() + '</span>'
  + '&nbsp; ' + m.percentComplete + '% complete · ' + m.budgetUsedPct + '% of budget used · ' + m.tasksOpen + ' open tasks</p>'
  + '<p><strong>Why ' + m.rag + ':</strong> ' + m.ragReasons.map(esc).join('; ') + '</p>'
  + '<h3>Summary</h3><p>' + esc(r.executiveSummary) + '</p>'
  + '<h3>Milestones</h3>' + milestones
  + '<h3>Done this week</h3>' + list(r.accomplishments)
  + '<h3>Next week</h3>' + list(r.nextWeek)
  + '<h3>Risks and issues</h3>' + risks
  + '<h3>Decisions needed</h3>' + list(r.decisionsNeeded)
  + '</div>';

return [{ json: { subject: r.subject, html, rag: m.rag } }];`
    }
  }
});

const createDraft = node({
  type: 'n8n-nodes-base.microsoftOutlook',
  version: 2,
  config: {
    name: 'Save as Outlook Draft',
    parameters: {
      resource: 'draft',
      operation: 'create',
      subject: expr('{{ $json.subject }}'),
      bodyContent: expr('{{ $json.html }}'),
      additionalFields: {
        bodyContentType: 'html',
        importance: expr('{{ $json.rag === "Red" ? "High" : "Normal" }}')
      }
    },
    credentials: { microsoftOutlookOAuth2Api: { id: 'YOUR_OUTLOOK_CREDENTIAL_ID', name: 'Microsoft Outlook' } }
  }
});

const note = sticky(`## Weekly Status Agent
**What it does:** every Friday it reads the project tracker, calculates health with fixed rules, has an AI draft the report, and saves it as an Outlook **draft**.

**Human in the loop:** nothing is sent automatically. The PM reviews, edits and sends.

**Design choice:** RAG is rule-based, not AI-decided, so the status is consistent and auditable. The AI only writes the narrative.

**To use with real data:** replace "Load Project Tracker (Sample)" with your tracker and keep the same fields.`, [loadTracker, calcHealth], { color: 5 });

export default workflow('weekly-status-agent', 'PM Agent 01: Weekly Status Report')
  .add(weeklySchedule)
  .to(loadTracker)
  .to(calcHealth)
  .to(draftReport)
  .to(formatEmail)
  .to(createDraft)
  .add(testRun)
  .to(loadTracker)
  .add(note)
  .group('Gather and score', [loadTracker, calcHealth], { description: 'Loads tracker data and sets the RAG status with fixed, auditable rules' })
  .group('AI drafting', [draftReport, geminiModel, reportParser, formatEmail], { description: 'Gemini writes the narrative from the facts; the email is formatted with the rule-based RAG' })
  .group('Human review', [createDraft], { description: 'Saved as an Outlook draft. The PM reviews and sends; nothing goes out automatically' });
