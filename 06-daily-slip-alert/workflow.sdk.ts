import { workflow, node, trigger, sticky, ifElse, languageModel, outputParser, expr } from '@n8n/workflow-sdk';

// ---------- Triggers ----------
const daily = trigger({
  type: 'n8n-nodes-base.scheduleTrigger', version: 1.4,
  config: { name: 'Weekdays 7:30 AM', parameters: { rule: { interval: [{ field: 'cronExpression', expression: '30 7 * * 1-5' }] } } }
});
const testRun = trigger({ type: 'n8n-nodes-base.manualTrigger', version: 1, config: { name: 'Test Run' } });

const settings = node({
  type: 'n8n-nodes-base.set', version: 3.4,
  config: {
    name: 'Settings',
    parameters: {
      mode: 'manual', includeOtherFields: false,
      assignments: { assignments: [
        { id: 'approver', name: 'approverEmail', value: 'YOUR_EMAIL@example.com', type: 'string' },
        { id: 'threshold', name: 'alertOnSlipDays', value: 1, type: 'number' }
      ] }
    }
  }
});

// ---------- Sense: read-only ----------
const readTracker = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Read Project Tracker',
    parameters: {
      mode: 'runOnceForAllItems', language: 'javaScript',
      jsCode: `// READ-ONLY CONNECTOR. Fictional sample with fixed dates.
// Swap for Jira, Asana, MS Project, Excel or Google Sheets; keep the same fields.
// Milestones need: name, baseline, forecast, dependsOn (the milestone before it, if any).
return [{ json: {
  project: 'Project Atlas: CRM Migration',
  milestones: [
    { name: 'Data migration dry run', baseline: '2026-12-01', forecast: '2026-12-08', dependsOn: null },
    { name: 'UAT start', baseline: '2026-12-15', forecast: '2026-12-17', dependsOn: 'Data migration dry run' },
    { name: 'Go-live', baseline: '2027-01-12', forecast: '2027-01-12', dependsOn: 'UAT start' }
  ],
  criticalTasks: [
    { id: 'T-102', task: 'Legacy data cleanse (accounts)', owner: 'M. Okafor', due: '2026-11-23', status: 'In Progress', milestone: 'Data migration dry run' },
    { id: 'T-104', task: 'API integration with billing system', owner: 'R. Patel', due: '2026-11-28', status: 'Blocked', blocker: 'Vendor sandbox credentials', milestone: 'Data migration dry run' },
    { id: 'T-107', task: 'UAT test scripts', owner: 'S. Nguyen', due: '2026-12-06', status: 'In Progress', milestone: 'UAT start' }
  ]
} }];`
    }
  }
});

const readSnapshot = node({
  type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: {
    name: 'Read Yesterday\'s Snapshot',
    alwaysOutputData: true,
    executeOnce: true,
    parameters: { resource: 'row', operation: 'get', dataTableId: { __rl: true, mode: 'name', value: 'pmd_milestone_snapshot' }, returnAll: true }
  }
});

// ---------- Analyse: rules decide whether to alert ----------
const detect = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Detect Changes (rules)',
    parameters: {
      mode: 'runOnceForAllItems', language: 'javaScript',
      jsCode: `// RULES, NOT AI, DECIDE WHETHER TO ALERT.
// Alert only when a milestone forecast moved by >= alertOnSlipDays since the last snapshot.
// Quiet days cost nothing: no AI call, no email.
const s = $('Settings').first().json;
const t = $('Read Project Tracker').first().json;
const prev = {};
$input.all().map(i => i.json).filter(r => r && r.milestone).forEach(r => { prev[r.milestone] = r; });
const DAY = 86400000;
const diff = (a, b) => Math.round((new Date(a) - new Date(b)) / DAY);
const today = new Date().toISOString().slice(0, 10);

const milestones = t.milestones.map(m => {
  const p = prev[m.name];
  const movedDays = p ? diff(m.forecast, p.forecast) : 0;
  return { ...m, previousForecast: p ? p.forecast : null, movedDays, vsBaselineDays: diff(m.forecast, m.baseline), isNew: !p };
});
const slips = milestones.filter(m => m.movedDays >= s.alertOnSlipDays);
const pullIns = milestones.filter(m => m.movedDays < 0);

// Knock-on: any later milestone that depends on a slipped one and has not moved yet
const knockOn = milestones.filter(m => m.dependsOn && slips.some(x => x.name === m.dependsOn) && m.movedDays === 0)
  .map(m => ({ name: m.name, dependsOn: m.dependsOn, forecast: m.forecast }));
const relatedTasks = t.criticalTasks.filter(k => slips.some(x => x.name === k.milestone));

return [{ json: {
  project: t.project, today,
  hasChanges: slips.length > 0,
  slips, pullIns, knockOn, relatedTasks, milestones,
  approverEmail: s.approverEmail
} }];`
    }
  }
});

// ---------- Always: refresh the snapshot so each change alerts only once ----------
const splitSnapshot = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Prepare Snapshot',
    parameters: {
      mode: 'runOnceForAllItems', language: 'javaScript',
      jsCode: `const d = $input.first().json;
return d.milestones.map(m => ({ json: { milestone: m.name, forecast: m.forecast, baseline: m.baseline, captured_on: d.today } }));`
    }
  }
});

const upsertSnapshot = node({
  type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: {
    name: 'Save Today\'s Snapshot',
    parameters: {
      resource: 'row', operation: 'upsert',
      dataTableId: { __rl: true, mode: 'name', value: 'pmd_milestone_snapshot' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'milestone', condition: 'eq', keyValue: expr('{{ $json.milestone }}') }] },
      columns: {
        mappingMode: 'defineBelow',
        value: { milestone: expr('{{ $json.milestone }}'), forecast: expr('{{ $json.forecast }}'), baseline: expr('{{ $json.baseline }}'), captured_on: expr('{{ $json.captured_on }}') },
        schema: [
          { id: 'milestone', displayName: 'milestone', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'forecast', displayName: 'forecast', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'baseline', displayName: 'baseline', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'captured_on', displayName: 'captured_on', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }
        ]
      }
    }
  }
});

const anySlip = ifElse({
  version: 2.2,
  config: {
    name: 'Anything Slipped?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.hasChanges }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    }
  }
});

// ---------- Propose (only on days something moved) ----------
const slipModel = languageModel({ type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', version: 1.2, config: { name: 'Gemini: Impact', parameters: { modelName: 'models/gemini-3-flash-preview', options: { temperature: 0.1 } }, credentials: { googlePalmApi: { id: 'YOUR_GEMINI_CREDENTIAL_ID', name: 'Google Gemini' } } } });

const slipParser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured', version: 1.3,
  config: {
    name: 'Impact Structure',
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{ "headline": "Dry run moved 4 days overnight; UAT start now at risk", "whatMoved": "Plain explanation of the change and its likely cause, citing task IDs", "knockOnRisk": "Which later milestones are exposed and how many days of buffer remain", "options": [{ "option": "Escalate vendor access to the sponsor today", "tradeOff": "Uses sponsor goodwill" }], "raidItem": { "raid_type": "Issue", "title": "Short title", "impact": "High", "likelihood": "High", "owner": "Name from the tracker", "mitigation": "Concrete action" } }'
    }
  }
});

const impactAgent = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm', version: 1.9,
  config: {
    name: 'Impact Analyst',
    parameters: {
      promptType: 'define',
      text: expr('You are a schedule analyst. A milestone forecast moved overnight. Using ONLY the data below:\n- headline: one line for the PM.\n- whatMoved: what changed, by how many days, and the likely cause (cite task IDs and blockers from relatedTasks).\n- knockOnRisk: which dependent milestones are exposed (knockOn) and how much buffer is left before they must move. Be precise with dates.\n- options: 2-3 recovery options, each with its trade-off. Do not pick one: the PM decides.\n- raidItem: ONE RAID entry for this slip, with an owner named in the data. impact and likelihood must each be exactly one word: High, Medium or Low. Put any explanation in mitigation, not in impact.\nNever invent dates, people or causes.\n\nPROJECT: {{ $json.project }} · TODAY: {{ $json.today }}\nSLIPPED: {{ JSON.stringify($json.slips) }}\nKNOCK-ON: {{ JSON.stringify($json.knockOn) }}\nRELATED CRITICAL TASKS: {{ JSON.stringify($json.relatedTasks) }}\nALL MILESTONES: {{ JSON.stringify($json.milestones) }}'),
      hasOutputParser: true
    },
    subnodes: { model: slipModel, outputParser: slipParser }
  }
});

const formatAlert = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Format Alert for PM',
    parameters: {
      mode: 'runOnceForAllItems', language: 'javaScript',
      jsCode: `const a = $input.first().json.output;
const d = $('Detect Changes (rules)').first().json;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const td = 'style="border:1px solid #ddd;padding:5px 8px;text-align:left;vertical-align:top"';
const rows = d.milestones.map(m => '<tr' + (m.movedDays > 0 ? ' style="background:#fdecea"' : '') + '><td ' + td + '>' + esc(m.name) + '</td><td ' + td + '>' + esc(m.previousForecast || 'n/a') + '</td><td ' + td + '><b>' + esc(m.forecast) + '</b></td><td ' + td + '>' + (m.movedDays > 0 ? '<b style="color:#b00020">+' + m.movedDays + ' days</b>' : (m.movedDays < 0 ? m.movedDays + ' days' : 'no change')) + '</td><td ' + td + '>' + (m.vsBaselineDays > 0 ? '+' + m.vsBaselineDays : m.vsBaselineDays) + ' vs baseline</td></tr>').join('');
const r = a.raidItem || {};
const html = '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222;max-width:760px">'
  + '<p style="font-size:12px;letter-spacing:1px;color:#b00020;margin:0">SLIP ALERT · AI PROPOSES · YOU DECIDE</p>'
  + '<h2 style="margin:4px 0">' + esc(a.headline) + '</h2>'
  + '<p style="color:#555;margin-top:0">' + esc(d.project) + ' · ' + esc(d.today) + '</p>'
  + '<table style="border-collapse:collapse;font-size:13px"><tr><th ' + td + '>Milestone</th><th ' + td + '>Yesterday</th><th ' + td + '>Today</th><th ' + td + '>Moved</th><th ' + td + '>Baseline</th></tr>' + rows + '</table>'
  + '<h3>What moved</h3><p>' + esc(a.whatMoved) + '</p>'
  + '<h3>Knock-on risk</h3><p>' + esc(a.knockOnRisk) + '</p>'
  + '<h3>Options (you choose)</h3><ol>' + (a.options || []).map(o => '<li><b>' + esc(o.option) + '</b><br><span style="color:#555">Trade-off: ' + esc(o.tradeOff) + '</span></li>').join('') + '</ol>'
  + '<h3>Proposed RAID entry (added if you acknowledge)</h3>'
  + '<p>' + esc(r.raid_type) + ': <b>' + esc(r.title) + '</b> · Impact ' + esc(r.impact) + ' · Likelihood ' + esc(r.likelihood) + ' · Owner ' + esc(r.owner) + '<br>Mitigation: ' + esc(r.mitigation) + '</p>'
  + '<p style="font-size:12px;color:#666">The slip itself was detected by rules (forecast moved overnight), not by AI. Acknowledge to log the RAID entry. Dismiss if it is already handled. Either way the decision is logged and you will not be alerted again for this same change.</p>'
  + '</div>';
return [{ json: { subject: '[Slip alert] ' + d.project + ': ' + d.slips.map(s => s.name + ' +' + s.movedDays + 'd').join(', '), html } }];`
    }
  }
});

// ---------- PM decides ----------
const approvalGate = node({
  type: 'n8n-nodes-base.microsoftOutlook', version: 2,
  config: {
    name: 'PM Approval Gate',
    parameters: {
      resource: 'message', operation: 'sendAndWait',
      toRecipients: expr('{{ $("Detect Changes (rules)").first().json.approverEmail }}'),
      subject: expr('{{ $json.subject }}'),
      message: expr('{{ $json.html }}'),
      responseType: 'approval',
      approvalOptions: { values: { approvalType: 'double', approveLabel: 'Acknowledge and log to RAID', disapproveLabel: 'Dismiss' } },
      options: { limitWaitTime: { values: { limitType: 'afterTimeInterval', resumeAmount: 1, resumeUnit: 'days' } }, appendAttribution: false }
    },
    credentials: { microsoftOutlookOAuth2Api: { id: 'YOUR_OUTLOOK_CREDENTIAL_ID', name: 'Microsoft Outlook' } }
  }
});

const isApproved = ifElse({
  version: 2.2,
  config: {
    name: 'Acknowledged?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.data.approved }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    }
  }
});

// ---------- Act + Log ----------
const insertRaid = node({
  type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: {
    name: 'Write-back: Add to RAID Log',
    parameters: {
      resource: 'row', operation: 'insert',
      dataTableId: { __rl: true, mode: 'name', value: 'pmd_raid_log' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          raid_type: expr('{{ $("Impact Analyst").first().json.output.raidItem.raid_type }}'),
          title: expr('{{ $("Impact Analyst").first().json.output.raidItem.title }}'),
          impact: expr('{{ $("Impact Analyst").first().json.output.raidItem.impact }}'),
          likelihood: expr('{{ $("Impact Analyst").first().json.output.raidItem.likelihood }}'),
          owner: expr('{{ $("Impact Analyst").first().json.output.raidItem.owner }}'),
          mitigation: expr('{{ $("Impact Analyst").first().json.output.raidItem.mitigation }}'),
          status: 'Open',
          source: expr('Slip alert run {{ $execution.id }} (PM acknowledged)')
        },
        schema: [
          { id: 'raid_type', displayName: 'raid_type', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'title', displayName: 'title', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'impact', displayName: 'impact', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'likelihood', displayName: 'likelihood', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'owner', displayName: 'owner', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'mitigation', displayName: 'mitigation', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'source', displayName: 'source', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }
        ]
      }
    }
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

const logAck = node({
  type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: {
    name: 'Log Acknowledgement',
    parameters: {
      resource: 'row', operation: 'insert',
      dataTableId: { __rl: true, mode: 'name', value: 'pmd_audit_log' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          run_id: expr('{{ $execution.id }}'), specialist: 'Slip Alert (rules) + Impact Analyst',
          proposal: expr('{{ $("Impact Analyst").first().json.output.headline }}'),
          decision: 'Acknowledged', decided_by: 'PM', write_back: '1 RAID entry added'
        },
        schema: AUDIT_SCHEMA
      }
    }
  }
});

const logDismiss = node({
  type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: {
    name: 'Log Dismissal',
    parameters: {
      resource: 'row', operation: 'insert',
      dataTableId: { __rl: true, mode: 'name', value: 'pmd_audit_log' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          run_id: expr('{{ $execution.id }}'), specialist: 'Slip Alert (rules) + Impact Analyst',
          proposal: expr('{{ $("Impact Analyst").first().json.output.headline }}'),
          decision: 'Dismissed (or no response in 1 day)', decided_by: 'PM', write_back: 'None'
        },
        schema: AUDIT_SCHEMA
      }
    }
  }
});

const note = sticky(`## 06 · Daily Slip Alert
Every weekday at 7:30 it compares today's milestone forecasts with yesterday's **snapshot**.

**Quiet day:** nothing moved, so no AI call and no email. The snapshot is refreshed.
**Something moved:** the **Impact Analyst** explains the cause, the knock-on risk and 2-3 options. You get one alert and choose **Acknowledge** (logs a RAID entry) or **Dismiss**.

**Guardrails:** rules decide when to alert · AI never picks the option · each change alerts once · read-only tracker · audit log`, [settings, readTracker, readSnapshot, detect], { color: 5 });

export default workflow('slip-alert', 'AI Proposes, PM Decides: 06 Daily Slip Alert')
  .add(daily)
  .to(settings)
  .to(readTracker)
  .to(readSnapshot)
  .to(detect)
  .to(splitSnapshot)
  .to(upsertSnapshot)
  .add(detect)
  .to(anySlip.onTrue(impactAgent.to(formatAlert.to(approvalGate.to(isApproved
    .onTrue(insertRaid.to(logAck))
    .onFalse(logDismiss))))))
  .add(testRun)
  .to(settings)
  .add(note)
  .group('Sense and detect', [settings, readTracker, readSnapshot, detect], { description: 'Reads the tracker and yesterday\'s snapshot; rules decide whether anything slipped' })
  .group('Snapshot', [splitSnapshot, upsertSnapshot], { description: 'Saves today\'s forecasts so the same change never alerts twice' })
  .group('Propose', [anySlip, impactAgent, slipModel, slipParser, formatAlert], { description: 'Only on slip days: cause, knock-on risk, options and one RAID entry' })
  .group('PM decides', [approvalGate, isApproved], { description: 'Acknowledge or dismiss by email' })
  .group('Act and log', [insertRaid, logAck], { description: 'Acknowledged: RAID entry and audit entry' });
