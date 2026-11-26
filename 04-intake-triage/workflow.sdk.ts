import { workflow, node, trigger, sticky, ifElse, languageModel, outputParser, expr } from '@n8n/workflow-sdk';

// ---------- Input: anyone can submit a request through this form ----------
const intakeForm = trigger({
  type: 'n8n-nodes-base.formTrigger',
  version: 2.6,
  config: {
    name: 'Request Intake Form',
    parameters: {
      formTitle: 'Submit a request to the project team',
      formDescription: 'Tell us what you need. The PM reviews every request and you will hear back with next steps.',
      formFields: {
        values: [
          { fieldLabel: 'Your name', fieldName: 'requesterName', fieldType: 'text', requiredField: true },
          { fieldLabel: 'Your email', fieldName: 'requesterEmail', fieldType: 'email', requiredField: true },
          { fieldLabel: 'Your team or department', fieldName: 'department', fieldType: 'text', placeholder: 'e.g. Sales Operations' },
          { fieldLabel: 'Request title', fieldName: 'title', fieldType: 'text', placeholder: 'One line, e.g. Add region filter to pipeline dashboard', requiredField: true },
          { fieldLabel: 'Describe what you need and why', fieldName: 'description', fieldType: 'textarea', requiredField: true },
          { fieldLabel: 'Business impact', fieldName: 'impact', fieldType: 'dropdown', fieldOptions: { values: [{ option: 'Blocks our work' }, { option: 'Affects customers or revenue' }, { option: 'Improvement / nice to have' }] }, requiredField: true },
          { fieldLabel: 'Needed by (optional)', fieldName: 'neededBy', fieldType: 'date' }
        ]
      },
      responseMode: 'onReceived',
      options: {
        buttonLabel: 'Submit request',
        path: 'project-intake',
        appendAttribution: false,
        respondWithOptions: { values: { respondWith: 'text', formSubmittedText: 'Thanks. Your request is with the project team and you will get a reply once the PM has reviewed it.' } }
      }
    }
  }
});

const settings = node({
  type: 'n8n-nodes-base.set', version: 3.4,
  config: {
    name: 'Settings',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          { id: 'approver', name: 'approverEmail', value: 'YOUR_EMAIL@example.com', type: 'string' },
          { id: 'routing', name: 'routingTable', value: 'Data and migration: M. Okafor | Integrations and APIs: R. Patel | Testing and UAT: S. Nguyen | Training and change: L. Martin | Reporting and dashboards: A. Chen | Anything else: the PM', type: 'string' }
        ]
      }
    }
  }
});

const readLog = node({
  type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: {
    name: 'Read Intake Log',
    alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'get', dataTableId: { __rl: true, mode: 'name', value: 'pmd_intake_log' }, returnAll: true }
  }
});

const prepare = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Prepare and Prioritise',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `// PRIORITY IS SET BY RULES HERE, NOT BY THE AI.
// P1: blocks work or hits customers/revenue AND needed within 14 days
// P2: blocks work or hits customers/revenue, OR needed within 14 days
// P3: everything else
const f = $('Settings').first().json;
const existing = $input.all().map(i => i.json).filter(r => r && r.title)
  .map(r => ({ title: r.title, status: r.status, routed_to: r.routed_to }));
const serious = f.impact === 'Blocks our work' || f.impact === 'Affects customers or revenue';
let daysLeft = null;
if (f.neededBy) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  daysLeft = Math.round((new Date(f.neededBy) - today) / 86400000);
}
const soon = daysLeft !== null && daysLeft <= 14;
const priority = serious && soon ? 'P1' : (serious || soon ? 'P2' : 'P3');
const reason = (serious ? f.impact : 'Improvement') + (daysLeft === null ? ', no deadline' : ', needed in ' + daysLeft + ' day(s)');
return [{ json: {
  requesterName: String(f.requesterName || '').trim(),
  requesterEmail: String(f.requesterEmail || '').trim(),
  department: String(f.department || '').trim(),
  title: String(f.title || '').trim(),
  description: String(f.description || '').trim().slice(0, 15000),
  impact: f.impact,
  neededBy: f.neededBy || 'Not given',
  priority, priorityReason: reason,
  routingTable: f.routingTable,
  existingRequests: existing,
  approverEmail: f.approverEmail
} }];`
    }
  }
});

// ---------- Propose ----------
const GEMINI = { googlePalmApi: { id: 'YOUR_GEMINI_CREDENTIAL_ID', name: 'Google Gemini' } };

const triageModel = languageModel({ type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', version: 1.2, config: { name: 'Gemini: Triage', parameters: { modelName: 'models/gemini-3-flash-preview', options: { temperature: 0.2 } }, credentials: GEMINI } });

const triageParser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured', version: 1.3,
  config: {
    name: 'Triage Structure',
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{ "requestType": "Change request", "summary": "One sentence restating what is needed and why", "size": "M", "sizeReason": "Why this size", "routeTo": "A. Chen", "routeReason": "Why this owner", "possibleDuplicateOf": "Title of an existing request, or empty", "missingInfo": ["Question to ask the requester"], "replyToRequester": { "subject": "Re: request title", "body": "Reply body" } }'
    }
  }
});

const triageAgent = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm', version: 1.9,
  config: {
    name: 'Intake Analyst',
    parameters: {
      promptType: 'define',
      text: expr('You are the intake analyst for a project team. Triage the request below for the PM.\n\n1. requestType: one of Bug, Change request, New work, Support, Question.\n2. summary: one plain sentence restating what is needed and why.\n3. size: S (under a day), M (a few days), L (1-3 weeks), XL (more than 3 weeks or needs its own project). Give a one-line reason. If the description is too vague to size, say so in sizeReason and pick the most likely size.\n4. routeTo: pick ONE owner from this routing table and explain why: {{ $json.routingTable }}\n5. possibleDuplicateOf: if the request overlaps with one of the EXISTING REQUESTS, give its exact title. Otherwise an empty string.\n6. missingInfo: questions the team needs answered before starting. Empty list if nothing is missing.\n7. replyToRequester: a short, warm, professional email to {{ $json.requesterName }}: thank them, restate your understanding in one line, say it has been logged as priority {{ $json.priority }} and the PM will confirm next steps, and ask the missingInfo questions if any. NEVER promise a delivery date. Under 120 words. Sign off as "The project team".\n\nPriority is already set by rules ({{ $json.priority }}: {{ $json.priorityReason }}). Do not change it.\nUse only what is in the request. Never invent details.\n\nREQUEST\nFrom: {{ $json.requesterName }} ({{ $json.department || "department not given" }})\nTitle: {{ $json.title }}\nImpact: {{ $json.impact }}\nNeeded by: {{ $json.neededBy }}\nDescription:\n{{ $json.description }}\n\nEXISTING REQUESTS:\n{{ JSON.stringify($json.existingRequests) }}'),
      hasOutputParser: true
    },
    subnodes: { model: triageModel, outputParser: triageParser }
  }
});

const formatApproval = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Format Proposal for PM',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const t = $input.first().json.output;
const r = $('Prepare and Prioritise').first().json;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ul = (a) => a && a.length ? '<ul>' + a.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '<p><em>Nothing missing</em></p>';
const pc = { P1: '#b00020', P2: '#b26a00', P3: '#1e7e34' };
const td = 'style="border:1px solid #ddd;padding:5px 8px;text-align:left;vertical-align:top"';
const row = (k, v) => '<tr><th ' + td + '>' + k + '</th><td ' + td + '>' + v + '</td></tr>';
const dup = t.possibleDuplicateOf ? '<p style="background:#fff3e0;border-left:4px solid #b26a00;padding:8px 12px"><b>Possible duplicate</b> of an existing request: <i>' + esc(t.possibleDuplicateOf) + '</i>. Consider merging instead of logging a new item.</p>' : '';
const html = '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222;max-width:760px">'
  + '<p style="font-size:12px;letter-spacing:1px;color:#b00020;margin:0">AI PROPOSES · YOU DECIDE</p>'
  + '<h2 style="margin:4px 0">New request: ' + esc(r.title) + '</h2>'
  + '<p style="color:#555;margin-top:0">From ' + esc(r.requesterName) + (r.department ? ' (' + esc(r.department) + ')' : '') + ' · ' + esc(r.requesterEmail) + '</p>'
  + dup
  + '<table style="border-collapse:collapse;font-size:13px">'
  + row('Priority (rules)', '<span style="background:' + pc[r.priority] + ';color:#fff;padding:2px 8px;border-radius:8px;font-weight:600">' + r.priority + '</span> ' + esc(r.priorityReason))
  + row('Type', esc(t.requestType))
  + row('Summary', esc(t.summary))
  + row('Size estimate', '<b>' + esc(t.size) + '</b>: ' + esc(t.sizeReason))
  + row('Route to', '<b>' + esc(t.routeTo) + '</b>: ' + esc(t.routeReason))
  + '</table>'
  + '<h3>Missing information</h3>' + ul(t.missingInfo)
  + '<h3>Reply to requester (saved as a draft if you approve)</h3>'
  + '<div style="border-left:3px solid #ccc;padding:6px 12px;background:#fafafa"><b>' + esc(t.replyToRequester.subject) + '</b><br>' + esc(t.replyToRequester.body).replace(/\\n/g, '<br>') + '</div>'
  + '<h3>Original request</h3><div style="font-size:13px;color:#444;border-left:3px solid #eee;padding:6px 12px">' + esc(r.description).replace(/\\n/g, '<br>') + '</div>'
  + '<p style="font-size:12px;color:#666">Nothing has been logged yet. Approve to add it to the intake log and save the reply as a draft. Reject to discard (no reply is drafted). Your decision is logged either way.</p>'
  + '</div>';
return [{ json: { subject: '[Approval needed] ' + r.priority + ' request: ' + r.title + (t.possibleDuplicateOf ? ' (possible duplicate)' : ''), html } }];`
    }
  }
});

// ---------- PM decides ----------
const approvalGate = node({
  type: 'n8n-nodes-base.microsoftOutlook', version: 2,
  config: {
    name: 'PM Approval Gate',
    parameters: {
      resource: 'message',
      operation: 'sendAndWait',
      toRecipients: expr('{{ $("Prepare and Prioritise").first().json.approverEmail }}'),
      subject: expr('{{ $json.subject }}'),
      message: expr('{{ $json.html }}'),
      responseType: 'approval',
      approvalOptions: { values: { approvalType: 'double', approveLabel: 'Accept and log', disapproveLabel: 'Reject' } },
      options: { limitWaitTime: { values: { limitType: 'afterTimeInterval', resumeAmount: 3, resumeUnit: 'days' } }, appendAttribution: false }
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

// ---------- Act (only after approval) + Log ----------
const logIntake = node({
  type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: {
    name: 'Write-back: Add to Intake Log',
    parameters: {
      resource: 'row', operation: 'insert',
      dataTableId: { __rl: true, mode: 'name', value: 'pmd_intake_log' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          title: expr('{{ $("Prepare and Prioritise").first().json.title }}'),
          requester: expr('{{ $("Prepare and Prioritise").first().json.requesterName }}'),
          request_type: expr('{{ $("Intake Analyst").first().json.output.requestType }}'),
          size: expr('{{ $("Intake Analyst").first().json.output.size }}'),
          priority: expr('{{ $("Prepare and Prioritise").first().json.priority }}'),
          routed_to: expr('{{ $("Intake Analyst").first().json.output.routeTo }}'),
          status: 'Accepted',
          source: expr('Intake run {{ $execution.id }} (PM approved)')
        },
        schema: [
          { id: 'title', displayName: 'title', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'requester', displayName: 'requester', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'request_type', displayName: 'request_type', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'size', displayName: 'size', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'priority', displayName: 'priority', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'routed_to', displayName: 'routed_to', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'source', displayName: 'source', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }
        ]
      }
    }
  }
});

const replyDraft = node({
  type: 'n8n-nodes-base.microsoftOutlook', version: 2,
  config: {
    name: 'Write-back: Save Reply as Draft',
    parameters: {
      resource: 'draft',
      operation: 'create',
      subject: expr('{{ $("Intake Analyst").first().json.output.replyToRequester.subject }}'),
      bodyContent: expr('{{ $("Intake Analyst").first().json.output.replyToRequester.body }}'),
      additionalFields: { bodyContentType: 'Text', toRecipients: expr('{{ $("Prepare and Prioritise").first().json.requesterEmail }}') }
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
      resource: 'row', operation: 'insert',
      dataTableId: { __rl: true, mode: 'name', value: 'pmd_audit_log' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          run_id: expr('{{ $execution.id }}'),
          specialist: 'Intake Analyst',
          proposal: expr('{{ $("Prepare and Prioritise").first().json.priority }} request: {{ $("Prepare and Prioritise").first().json.title }}'),
          decision: 'Accepted',
          decided_by: 'PM',
          write_back: expr('Logged to intake, routed to {{ $("Intake Analyst").first().json.output.routeTo }}, reply draft saved')
        },
        schema: AUDIT_SCHEMA
      }
    }
  }
});

const logRejected = node({
  type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: {
    name: 'Log Rejection',
    parameters: {
      resource: 'row', operation: 'insert',
      dataTableId: { __rl: true, mode: 'name', value: 'pmd_audit_log' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          run_id: expr('{{ $execution.id }}'),
          specialist: 'Intake Analyst',
          proposal: expr('{{ $("Prepare and Prioritise").first().json.priority }} request: {{ $("Prepare and Prioritise").first().json.title }}'),
          decision: 'Rejected (or no response in 3 days)',
          decided_by: 'PM',
          write_back: 'None'
        },
        schema: AUDIT_SCHEMA
      }
    }
  }
});

const note = sticky(`## 04 · Intake Triage
**Input:** share the form link with stakeholders. Anyone can submit a request.

**Rules** set the priority (impact + deadline). The **Intake Analyst** classifies it, estimates size, picks an owner from your routing table, spots duplicates, lists missing information and drafts a reply. The PM gets one approval email.

**Guardrails:** priority by rules, not AI · duplicate check against the intake log · reply never promises a date · nothing logged or drafted before approval · audit log`, [intakeForm, settings, readLog, prepare], { color: 5 });

export default workflow('intake-triage', 'AI Proposes, PM Decides: 04 Intake Triage')
  .add(intakeForm)
  .to(settings)
  .to(readLog)
  .to(prepare)
  .to(triageAgent)
  .to(formatApproval)
  .to(approvalGate)
  .to(isApproved
    .onTrue(logIntake.to(replyDraft.to(logApproved)))
    .onFalse(logRejected))
  .add(note)
  .group('Input and rules', [settings, readLog, prepare], { description: 'Settings and routing table, existing requests for duplicate checks, rule-based priority' })
  .group('Propose', [triageAgent, triageModel, triageParser, formatApproval], { description: 'Intake Analyst classifies, sizes, routes, spots duplicates and drafts the reply' })
  .group('PM decides', [approvalGate, isApproved], { description: 'Accept or reject by email. Nothing is logged before this point.' })
  .group('Act and log', [logIntake, replyDraft, logApproved], { description: 'Only after approval: intake log entry, reply draft to the requester, audit entry' });
