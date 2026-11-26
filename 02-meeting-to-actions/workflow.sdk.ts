import { workflow, node, trigger, sticky, ifElse, switchCase, languageModel, outputParser, expr } from '@n8n/workflow-sdk';

// ---------- Input: the PM fills in this form ----------
const meetingForm = trigger({
  type: 'n8n-nodes-base.formTrigger',
  version: 2.6,
  config: {
    name: 'PM Input Form',
    parameters: {
      formTitle: 'Meeting → Actions',
      formDescription: 'Paste a meeting transcript or your rough notes. The agent proposes decisions, actions, owners and risks, and emails them to you for approval. Nothing is saved until you approve.',
      formFields: {
        values: [
          { fieldLabel: 'Meeting name', fieldName: 'meetingName', fieldType: 'text', placeholder: 'e.g. Project Atlas weekly sync', requiredField: true },
          { fieldLabel: 'Meeting date', fieldName: 'meetingDate', fieldType: 'date', requiredField: true },
          { fieldLabel: 'Attendee emails (for the follow-up draft)', fieldName: 'attendees', fieldType: 'text', placeholder: 'name@company.com, name2@company.com' },
          { fieldLabel: 'Transcript or notes', fieldName: 'transcript', fieldType: 'textarea', placeholder: 'Paste the Teams/Zoom transcript or your notes here', requiredField: true }
        ]
      },
      responseMode: 'onReceived',
      options: {
        buttonLabel: 'Send to agent',
        path: 'meeting-to-actions',
        appendAttribution: false,
        respondWithOptions: { values: { respondWith: 'text', formSubmittedText: 'Got it. The agent is reading your meeting. You will get an approval email in about a minute.' } }
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
          { id: 'pause', name: 'pauseSeconds', value: 13, type: 'number' }
        ]
      }
    }
  }
});

const prepare = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Prepare Input',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `// Basic hygiene before the AI sees the text: trim, cap length, tidy attendee list.
const f = $input.first().json;
const MAX = 40000;
let transcript = String(f.transcript || '').trim();
const truncated = transcript.length > MAX;
if (truncated) transcript = transcript.slice(0, MAX);
const attendees = String(f.attendees || '').split(/[,;\\s]+/).map(s => s.trim()).filter(s => s.includes('@'));
return [{ json: {
  meetingName: String(f.meetingName || 'Untitled meeting').trim(),
  meetingDate: f.meetingDate,
  attendees,
  transcript,
  truncated,
  approverEmail: f.approverEmail,
  pauseSeconds: f.pauseSeconds
} }];`
    }
  }
});

// ---------- Propose ----------
const GEMINI = { googlePalmApi: { id: 'YOUR_GEMINI_CREDENTIAL_ID', name: 'Google Gemini' } };
const MODEL = 'models/gemini-3-flash-preview';

const extractModel = languageModel({ type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', version: 1.2, config: { name: 'Gemini: Extract', parameters: { modelName: MODEL, options: { temperature: 0.1 } }, credentials: GEMINI } });
const followupModel = languageModel({ type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', version: 1.2, config: { name: 'Gemini: Follow-up', parameters: { modelName: MODEL, options: { temperature: 0.3 } }, credentials: GEMINI } });

const extractParser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured', version: 1.3,
  config: {
    name: 'Meeting Structure',
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{ "summary": "Two or three sentences on what the meeting was about and what it settled.", "decisions": [{ "decision": "Go-live stays on 12 January", "madeBy": "Sponsor" }], "actions": [{ "action": "Escalate sandbox access with the billing vendor", "owner": "R. Patel", "dueDate": "2026-11-28", "confidence": "High", "sourceQuote": "Raj, can you chase the vendor by Friday?" }], "risks": [{ "raid_type": "Risk", "title": "Short title", "impact": "High", "likelihood": "Medium", "owner": "Name", "mitigation": "Concrete action" }], "openQuestions": ["Who owns the training demo?"] }'
    }
  }
});

const followupParser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured', version: 1.3,
  config: { name: 'Follow-up Structure', parameters: { schemaType: 'fromJson', jsonSchemaExample: '{ "subject": "Follow-up: Project Atlas weekly sync (26 Nov)", "body": "Email body" }' } }
});

const extractAgent = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm', version: 1.9,
  config: {
    name: 'Meeting Analyst',
    parameters: {
      promptType: 'define',
      text: expr('You are a meeting analyst on a PM team. Read the meeting below and extract what was decided, what people committed to do, new risks or issues, and open questions.\n\nRules:\n- Use ONLY what is in the text. Never invent people, dates or commitments.\n- An action needs a clear owner. If nobody clearly took it, set owner to "UNASSIGNED".\n- dueDate only if a date or day was stated (convert relative days like "Friday" using the meeting date {{ $json.meetingDate }}). Otherwise "TBD".\n- confidence: High if the owner explicitly agreed, Medium if implied, Low if unclear.\n- sourceQuote: the short phrase from the text that supports the action.\n- Risks: only genuine risks or issues raised in the meeting, with impact and likelihood High/Medium/Low.\n- Ignore small talk.\n\nMEETING: {{ $json.meetingName }} ({{ $json.meetingDate }})\n\nTRANSCRIPT / NOTES:\n{{ $json.transcript }}'),
      hasOutputParser: true
    },
    subnodes: { model: extractModel, outputParser: extractParser }
  }
});

const pace = node({ type: 'n8n-nodes-base.wait', version: 1.1, config: { name: 'Pace', parameters: { resume: 'timeInterval', amount: expr('{{ $("Prepare Input").first().json.pauseSeconds }}'), unit: 'seconds' } } });

const followupAgent = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm', version: 1.9,
  config: {
    name: 'Follow-up Writer',
    parameters: {
      promptType: 'define',
      text: expr('You write meeting follow-up emails for a project manager. Using ONLY the extracted items below, write a short follow-up email to the attendees: one-line thanks, a short summary, Decisions, Actions (owner and due date for each), and Open questions. Clear, friendly, professional. Under 200 words. Plain text. Sign off as "Thanks". Do not add anything that is not in the items.\n\nMEETING: {{ $("Prepare Input").first().json.meetingName }} ({{ $("Prepare Input").first().json.meetingDate }})\n\nEXTRACTED ITEMS:\n{{ JSON.stringify($("Meeting Analyst").first().json.output) }}'),
      hasOutputParser: true
    },
    subnodes: { model: followupModel, outputParser: followupParser }
  }
});

const formatApproval = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Format Proposal for PM',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const m = $('Meeting Analyst').first().json.output;
const f = $input.first().json.output;
const inp = $('Prepare Input').first().json;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ul = (a) => a && a.length ? '<ul>' + a.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '<p><em>None</em></p>';
const td = 'style="border:1px solid #ddd;padding:5px 8px;text-align:left;vertical-align:top"';
const flag = (a) => (a.owner === 'UNASSIGNED' || a.confidence === 'Low') ? ' style="background:#fff3e0"' : '';
const actions = (m.actions || []).length
  ? '<table style="border-collapse:collapse;font-size:13px"><tr><th ' + td + '>Action</th><th ' + td + '>Owner</th><th ' + td + '>Due</th><th ' + td + '>Confidence</th><th ' + td + '>From the meeting</th></tr>'
    + m.actions.map(a => '<tr' + flag(a) + '><td ' + td + '>' + esc(a.action) + '</td><td ' + td + '>' + esc(a.owner) + '</td><td ' + td + '>' + esc(a.dueDate) + '</td><td ' + td + '>' + esc(a.confidence) + '</td><td ' + td + '><i>"' + esc(a.sourceQuote) + '"</i></td></tr>').join('') + '</table>'
    + '<p style="font-size:12px;color:#666">Highlighted rows have no clear owner or low confidence. Check them before approving.</p>'
  : '<p><em>No actions found</em></p>';
const risks = (m.risks || []).length
  ? '<table style="border-collapse:collapse;font-size:13px"><tr><th ' + td + '>Type</th><th ' + td + '>Title</th><th ' + td + '>Impact</th><th ' + td + '>Likelihood</th><th ' + td + '>Owner</th><th ' + td + '>Mitigation</th></tr>'
    + m.risks.map(r => '<tr><td ' + td + '>' + esc(r.raid_type) + '</td><td ' + td + '>' + esc(r.title) + '</td><td ' + td + '>' + esc(r.impact) + '</td><td ' + td + '>' + esc(r.likelihood) + '</td><td ' + td + '>' + esc(r.owner) + '</td><td ' + td + '>' + esc(r.mitigation) + '</td></tr>').join('') + '</table>'
  : '<p><em>No new risks</em></p>';

const html = '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222;max-width:760px">'
  + '<p style="font-size:12px;letter-spacing:1px;color:#b00020;margin:0">AI PROPOSES · YOU DECIDE</p>'
  + '<h2 style="margin:4px 0">' + esc(inp.meetingName) + ' · ' + esc(inp.meetingDate) + '</h2>'
  + (inp.truncated ? '<p style="color:#b00020">Note: the transcript was very long and only the first part was analysed.</p>' : '')
  + '<p>' + esc(m.summary) + '</p>'
  + '<h3>1 · Decisions</h3>' + ul((m.decisions || []).map(d => d.decision + (d.madeBy ? ' (' + d.madeBy + ')' : '')))
  + '<h3>2 · Actions (will be added to the action log if you approve)</h3>' + actions
  + '<h3>3 · New risks and issues (will be added to the RAID log if you approve)</h3>' + risks
  + '<h3>4 · Open questions</h3>' + ul(m.openQuestions)
  + '<h3>5 · Follow-up email (will be saved as a draft to ' + (inp.attendees.length ? esc(inp.attendees.join(', ')) : 'no recipients yet') + ')</h3>'
  + '<div style="border-left:3px solid #ccc;padding:6px 12px;background:#fafafa"><b>' + esc(f.subject) + '</b><br>' + esc(f.body).replace(/\\n/g, '<br>') + '</div>'
  + '<p style="font-size:12px;color:#666">Nothing has been saved yet. Approve to log the actions and risks and save the follow-up as a draft. Reject to discard. Your decision is logged either way.</p>'
  + '</div>';
return [{ json: { subject: '[Approval needed] Actions from ' + inp.meetingName, html } }];`
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
      toRecipients: expr('{{ $("Prepare Input").first().json.approverEmail }}'),
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

// ---------- Act (only after approval) + Log ----------
const followupDraft = node({
  type: 'n8n-nodes-base.microsoftOutlook', version: 2,
  config: {
    name: 'Write-back: Save Follow-up as Draft',
    parameters: {
      resource: 'draft',
      operation: 'create',
      subject: expr('{{ $("Follow-up Writer").first().json.output.subject }}'),
      bodyContent: expr('{{ $("Follow-up Writer").first().json.output.body }}'),
      additionalFields: { bodyContentType: 'Text', toRecipients: expr('{{ $("Prepare Input").first().json.attendees.join(",") }}') }
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
          specialist: 'Meeting Analyst + Follow-up Writer',
          proposal: expr('Actions from {{ $("Prepare Input").first().json.meetingName }}'),
          decision: 'Approved',
          decided_by: 'PM',
          write_back: expr('{{ ($("Meeting Analyst").first().json.output.actions || []).length }} action(s), {{ ($("Meeting Analyst").first().json.output.risks || []).length }} RAID item(s), follow-up draft saved')
        },
        schema: AUDIT_SCHEMA
      }
    }
  }
});

const splitItems = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Split Actions and Risks',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const m = $('Meeting Analyst').first().json.output;
const inp = $('Prepare Input').first().json;
const src = 'Meeting run ' + $execution.id + ' (PM approved)';
const actions = (m.actions || []).map(a => ({ json: { target: 'action', meeting: inp.meetingName, meeting_date: inp.meetingDate, action: a.action, owner: a.owner, due_date: a.dueDate, status: 'Open', source: src } }));
const risks = (m.risks || []).map(r => ({ json: { target: 'raid', raid_type: r.raid_type, title: r.title, impact: r.impact, likelihood: r.likelihood, owner: r.owner, mitigation: r.mitigation, status: 'Open', source: src } }));
return actions.concat(risks);`
    }
  }
});

const route = switchCase({
  version: 3.2,
  config: {
    name: 'Route to Log',
    parameters: {
      rules: {
        values: [
          { outputKey: 'action', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.target }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'action' }], combinator: 'and' } },
          { outputKey: 'raid', conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.target }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'raid' }], combinator: 'and' } }
        ]
      }
    }
  }
});


const insertActions = node({
  type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: {
    name: 'Write-back: Add to Action Log',
    parameters: {
      resource: 'row', operation: 'insert',
      dataTableId: { __rl: true, mode: 'name', value: 'pmd_action_log' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          meeting: expr('{{ $json.meeting }}'), meeting_date: expr('{{ $json.meeting_date }}'), action: expr('{{ $json.action }}'),
          owner: expr('{{ $json.owner }}'), due_date: expr('{{ $json.due_date }}'), status: expr('{{ $json.status }}'), source: expr('{{ $json.source }}')
        },
        schema: [
          { id: 'meeting', displayName: 'meeting', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'meeting_date', displayName: 'meeting_date', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'action', displayName: 'action', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'owner', displayName: 'owner', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'due_date', displayName: 'due_date', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'source', displayName: 'source', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }
        ]
      }
    }
  }
});

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
          raid_type: expr('{{ $json.raid_type }}'), title: expr('{{ $json.title }}'), impact: expr('{{ $json.impact }}'),
          likelihood: expr('{{ $json.likelihood }}'), owner: expr('{{ $json.owner }}'), mitigation: expr('{{ $json.mitigation }}'),
          status: expr('{{ $json.status }}'), source: expr('{{ $json.source }}')
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
          specialist: 'Meeting Analyst + Follow-up Writer',
          proposal: expr('Actions from {{ $("Prepare Input").first().json.meetingName }}'),
          decision: 'Rejected (or no response in 2 days)',
          decided_by: 'PM',
          write_back: 'None'
        },
        schema: AUDIT_SCHEMA
      }
    }
  }
});

const note = sticky(`## 02 · Meeting → Actions
**PM input:** open the form (PM Input Form → copy the URL), paste a transcript or notes, submit.

The **Meeting Analyst** extracts decisions, actions (owner, due date, confidence, supporting quote), risks and open questions. The **Follow-up Writer** drafts the attendee email. You get one approval email. Nothing is saved until you approve.

**Guardrails:** no invented owners (UNASSIGNED instead) · every action quotes the meeting · low-confidence rows highlighted · audit log`, [meetingForm, settings, prepare], { color: 5 });

export default workflow('meeting-to-actions', 'AI Proposes, PM Decides: 02 Meeting → Actions')
  .add(meetingForm)
  .to(settings)
  .to(prepare)
  .to(extractAgent)
  .to(pace)
  .to(followupAgent)
  .to(formatApproval)
  .to(approvalGate)
  .to(isApproved
    .onTrue(followupDraft.to(logApproved.to(splitItems.to(route.onCase(0, insertActions).onCase(1, insertRaid)))))
    .onFalse(logRejected))
  .add(note)
  .group('Input', [settings, prepare], { description: 'Takes the PM form input, adds settings, trims and tidies the transcript' })
  .group('Propose', [extractAgent, extractModel, extractParser, pace, followupAgent, followupModel, followupParser, formatApproval], { description: 'Meeting Analyst extracts items with evidence; Follow-up Writer drafts the attendee email' })
  .group('PM decides', [approvalGate, isApproved], { description: 'Approve or reject by email. Nothing is saved before this point.' })
  .group('Act and log', [followupDraft, logApproved, splitItems, route, insertActions, insertRaid], { description: 'Only after approval: follow-up draft, action log, RAID log, audit entry' });
