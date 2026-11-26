import { workflow, node, trigger, sticky, ifElse, languageModel, outputParser, expr } from '@n8n/workflow-sdk';

// ---------- Input 1: anonymous team feedback (no name, no email) ----------
const feedbackForm = trigger({
  type: 'n8n-nodes-base.formTrigger',
  version: 2.6,
  config: {
    name: 'Team Feedback Form',
    parameters: {
      formTitle: 'Retro feedback (anonymous)',
      formDescription: 'We do not collect your name or email. Be honest: the PM only sees themes and anonymous quotes, never who said what.',
      formFields: {
        values: [
          { fieldLabel: 'Retro / sprint name', fieldName: 'retro', fieldType: 'text', placeholder: 'e.g. Atlas Sprint 14', requiredField: true },
          { fieldLabel: 'How did this sprint feel? (1 = rough, 5 = great)', fieldName: 'mood', fieldType: 'dropdown', fieldOptions: { values: [{ option: '1' }, { option: '2' }, { option: '3' }, { option: '4' }, { option: '5' }] }, requiredField: true },
          { fieldLabel: 'What went well?', fieldName: 'wentWell', fieldType: 'textarea' },
          { fieldLabel: 'What should we improve?', fieldName: 'toImprove', fieldType: 'textarea' },
          { fieldLabel: 'Any ideas?', fieldName: 'ideas', fieldType: 'textarea' }
        ]
      },
      responseMode: 'onReceived',
      options: { buttonLabel: 'Send anonymously', path: 'retro-feedback', appendAttribution: false, respondWithOptions: { values: { respondWith: 'text', formSubmittedText: 'Thanks. Your feedback was saved anonymously.' } } }
    }
  }
});

const storeFeedback = node({
  type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: {
    name: 'Store Feedback (anonymous)',
    parameters: {
      resource: 'row', operation: 'insert',
      dataTableId: { __rl: true, mode: 'name', value: 'pmd_retro_feedback' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          retro: expr('{{ $json.retro.trim() }}'), mood: expr('{{ $json.mood }}'),
          went_well: expr('{{ $json.wentWell || "" }}'), to_improve: expr('{{ $json.toImprove || "" }}'), ideas: expr('{{ $json.ideas || "" }}')
        },
        schema: [
          { id: 'retro', displayName: 'retro', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'mood', displayName: 'mood', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'went_well', displayName: 'went_well', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'to_improve', displayName: 'to_improve', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'ideas', displayName: 'ideas', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }
        ]
      }
    }
  }
});

// ---------- Input 2: the PM asks for the synthesis ----------
const pmForm = trigger({
  type: 'n8n-nodes-base.formTrigger',
  version: 2.6,
  config: {
    name: 'PM Synthesize Form',
    parameters: {
      formTitle: 'Synthesize a retro',
      formDescription: 'Pick the retro. The agent groups the anonymous feedback into themes and proposes actions. You approve before anything is logged.',
      formFields: {
        values: [
          { fieldLabel: 'Retro / sprint name', fieldName: 'retro', fieldType: 'text', placeholder: 'e.g. Atlas Sprint 14', requiredField: true },
          { fieldLabel: 'Team email(s) for the summary draft', fieldName: 'teamTo', fieldType: 'text', placeholder: 'optional, comma separated' }
        ]
      },
      responseMode: 'onReceived',
      options: { buttonLabel: 'Synthesize', path: 'retro-synthesize', appendAttribution: false, respondWithOptions: { values: { respondWith: 'text', formSubmittedText: 'Working on it. The synthesis will arrive by email for your approval.' } } }
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
          { id: 'min', name: 'minResponses', value: 3, type: 'number' }
        ]
      }
    }
  }
});

const readFeedback = node({
  type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: {
    name: 'Read Feedback for Retro',
    alwaysOutputData: true,
    parameters: {
      resource: 'row', operation: 'get',
      dataTableId: { __rl: true, mode: 'name', value: 'pmd_retro_feedback' },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'retro', condition: 'eq', keyValue: expr('{{ $json.retro.trim() }}') }] },
      returnAll: true
    }
  }
});

const prepare = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Check Responses',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `// ANONYMITY RULE: no synthesis below the minimum number of responses,
// because with only one or two people the themes would identify them.
const s = $('Settings').first().json;
const rows = $input.all().map(i => i.json).filter(r => r && (r.went_well || r.to_improve || r.ideas));
const moods = rows.map(r => Number(r.mood)).filter(n => n >= 1 && n <= 5);
const avgMood = moods.length ? Math.round((moods.reduce((a, b) => a + b, 0) / moods.length) * 10) / 10 : null;
const teamTo = String(s.teamTo || '').split(/[,;\\s]+/).map(x => x.trim()).filter(x => x.includes('@'));
return [{ json: {
  retro: String(s.retro).trim(),
  count: rows.length,
  enough: rows.length >= s.minResponses,
  minResponses: s.minResponses,
  avgMood,
  feedback: rows.map(r => ({ mood: r.mood, wentWell: r.went_well, toImprove: r.to_improve, ideas: r.ideas })),
  teamTo,
  approverEmail: s.approverEmail
} }];`
    }
  }
});

const enoughCheck = ifElse({
  version: 2.2,
  config: {
    name: 'Enough Responses?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.enough }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and'
      }
    }
  }
});

const notEnough = node({
  type: 'n8n-nodes-base.microsoftOutlook', version: 2,
  config: {
    name: 'Tell PM: Not Enough Responses',
    parameters: {
      resource: 'message',
      operation: 'send',
      toRecipients: expr('{{ $json.approverEmail }}'),
      subject: expr('Retro "{{ $json.retro }}": only {{ $json.count }} response(s), synthesis skipped'),
      bodyContent: expr('The retro "{{ $json.retro }}" has {{ $json.count }} response(s). The minimum is {{ $json.minResponses }}, to protect anonymity. Ask the team to fill in the feedback form, then run the synthesis again.'),
      additionalFields: { bodyContentType: 'Text' }
    },
    credentials: { microsoftOutlookOAuth2Api: { id: 'YOUR_OUTLOOK_CREDENTIAL_ID', name: 'Microsoft Outlook' } }
  }
});

// ---------- Propose ----------
const retroModel = languageModel({ type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', version: 1.2, config: { name: 'Gemini: Retro', parameters: { modelName: 'models/gemini-3-flash-preview', options: { temperature: 0.2 } }, credentials: { googlePalmApi: { id: 'YOUR_GEMINI_CREDENTIAL_ID', name: 'Google Gemini' } } } });

const retroParser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured', version: 1.3,
  config: {
    name: 'Retro Structure',
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{ "summary": "Two sentences on how the sprint went overall", "wentWell": [{ "theme": "Early delivery", "count": 2, "quote": "Dashboards shipped early" }], "toImprove": [{ "theme": "Late warning on vendor dependency", "count": 2, "quote": "Felt late", "recurring": false }], "proposedActions": [{ "action": "Add vendor dependencies to the standup board", "why": "Two people were surprised by the vendor delay", "successMeasure": "No dependency surprises next sprint" }], "discussionQuestions": ["What would have warned us earlier?"], "teamSummaryEmail": { "subject": "Sprint 14 retro: what we heard", "body": "Email body" } }'
    }
  }
});

const retroAgent = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm', version: 1.9,
  config: {
    name: 'Retro Analyst',
    parameters: {
      promptType: 'define',
      text: expr('You are a retrospective facilitator. Synthesize the ANONYMOUS team feedback below for the PM.\n\nRules:\n- Group feedback into themes. count = how many responses mention the theme. Sort by count, highest first.\n- quote: a short verbatim phrase from the feedback. NEVER include a quote that names or clearly identifies a person, role or individual workload. Paraphrase it instead.\n- NEVER guess who wrote anything. Never name people.\n- recurring: true only if the feedback itself says it happened before (e.g. "again", "same as last sprint").\n- proposedActions: at most 3, each small, concrete and doable in one sprint, with why and a measurable successMeasure. Prefer actions the team itself suggested. Do not assign owners: the team agrees owners in the retro meeting.\n- discussionQuestions: 2-3 open questions to run the retro meeting.\n- teamSummaryEmail: a short, appreciative email to the team: what we heard, the proposed actions, and that owners will be agreed in the retro. No names. Sign off as "Thanks, the PM".\n\nRETRO: {{ $json.retro }}\nRESPONSES: {{ $json.count }} · AVERAGE MOOD: {{ $json.avgMood }} / 5\n\nFEEDBACK:\n{{ JSON.stringify($json.feedback) }}'),
      hasOutputParser: true
    },
    subnodes: { model: retroModel, outputParser: retroParser }
  }
});

const formatApproval = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Format Proposal for PM',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const x = $input.first().json.output;
const c = $('Check Responses').first().json;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const td = 'style="border:1px solid #ddd;padding:5px 8px;text-align:left;vertical-align:top"';
const themes = (list, showRec) => (list && list.length)
  ? '<table style="border-collapse:collapse;font-size:13px"><tr><th ' + td + '>Theme</th><th ' + td + '>Mentions</th><th ' + td + '>In their words</th></tr>'
    + list.map(t => '<tr><td ' + td + '>' + esc(t.theme) + (showRec && t.recurring ? ' <span style="color:#b00020;font-weight:600">↻ recurring</span>' : '') + '</td><td ' + td + '>' + esc(t.count) + '</td><td ' + td + '><i>"' + esc(t.quote) + '"</i></td></tr>').join('') + '</table>'
  : '<p><em>None</em></p>';
const actions = (x.proposedActions || []).length
  ? '<ol>' + x.proposedActions.map(a => '<li><b>' + esc(a.action) + '</b><br><span style="color:#555">Why: ' + esc(a.why) + ' · Success: ' + esc(a.successMeasure) + '</span></li>').join('') + '</ol>'
  : '<p><em>No actions proposed</em></p>';
const mood = c.avgMood === null ? 'n/a' : c.avgMood + ' / 5';
const html = '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222;max-width:760px">'
  + '<p style="font-size:12px;letter-spacing:1px;color:#b00020;margin:0">AI PROPOSES · YOU DECIDE</p>'
  + '<h2 style="margin:4px 0">Retro synthesis: ' + esc(c.retro) + '</h2>'
  + '<p style="color:#555;margin-top:0">' + c.count + ' anonymous responses · average mood ' + mood + '</p>'
  + '<p>' + esc(x.summary) + '</p>'
  + '<h3>What went well</h3>' + themes(x.wentWell, false)
  + '<h3>What to improve</h3>' + themes(x.toImprove, true)
  + '<h3>Proposed actions (added to the action log as UNASSIGNED if you approve; owners agreed in the retro)</h3>' + actions
  + '<h3>Questions to open the retro</h3><ul>' + (x.discussionQuestions || []).map(q => '<li>' + esc(q) + '</li>').join('') + '</ul>'
  + '<h3>Team summary (saved as a draft if you approve)</h3>'
  + '<div style="border-left:3px solid #ccc;padding:6px 12px;background:#fafafa"><b>' + esc(x.teamSummaryEmail.subject) + '</b><br>' + esc(x.teamSummaryEmail.body).replace(/\\n/g, '<br>') + '</div>'
  + '<p style="font-size:12px;color:#666">Check the quotes: none should identify a person. Nothing has been saved yet. Approve to log the actions and save the team summary as a draft. Reject to discard. Your decision is logged either way.</p>'
  + '</div>';
return [{ json: { subject: '[Approval needed] Retro synthesis: ' + c.retro + ' (' + c.count + ' responses)', html } }];`
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
      toRecipients: expr('{{ $("Check Responses").first().json.approverEmail }}'),
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
const summaryDraft = node({
  type: 'n8n-nodes-base.microsoftOutlook', version: 2,
  config: {
    name: 'Write-back: Save Team Summary as Draft',
    parameters: {
      resource: 'draft',
      operation: 'create',
      subject: expr('{{ $("Retro Analyst").first().json.output.teamSummaryEmail.subject }}'),
      bodyContent: expr('{{ $("Retro Analyst").first().json.output.teamSummaryEmail.body }}'),
      additionalFields: { bodyContentType: 'Text', toRecipients: expr('{{ $("Check Responses").first().json.teamTo.join(",") }}') }
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
          specialist: 'Retro Analyst',
          proposal: expr('Retro synthesis: {{ $("Check Responses").first().json.retro }} ({{ $("Check Responses").first().json.count }} responses)'),
          decision: 'Approved',
          decided_by: 'PM',
          write_back: expr('{{ ($("Retro Analyst").first().json.output.proposedActions || []).length }} action(s) logged as UNASSIGNED, team summary draft saved')
        },
        schema: AUDIT_SCHEMA
      }
    }
  }
});

const splitActions = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Split Retro Actions',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const x = $('Retro Analyst').first().json.output;
const c = $('Check Responses').first().json;
return (x.proposedActions || []).map(a => ({ json: { meeting: 'Retro: ' + c.retro, meeting_date: new Date().toISOString().slice(0, 10), action: a.action + ' (success: ' + a.successMeasure + ')', owner: 'UNASSIGNED (agree in retro)', due_date: 'Next sprint', status: 'Open', source: 'Retro run ' + $execution.id + ' (PM approved)' } }));`
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
          specialist: 'Retro Analyst',
          proposal: expr('Retro synthesis: {{ $("Check Responses").first().json.retro }}'),
          decision: 'Rejected (or no response in 2 days)',
          decided_by: 'PM',
          write_back: 'None'
        },
        schema: AUDIT_SCHEMA
      }
    }
  }
});

const note = sticky(`## 05 · Retro Synthesizer
**Two forms.** The team fills in the **anonymous** feedback form (no name, no email). When ready, the PM opens the **Synthesize** form and picks the retro.

**Anonymity rule:** no synthesis below the minimum number of responses (Settings → minResponses). The **Retro Analyst** groups feedback into themes with counts and anonymous quotes, flags recurring problems, proposes up to 3 measurable actions and drafts a team summary. Owners are agreed in the retro, not by the AI.

**Guardrails:** no names collected · no quotes that identify anyone · minimum responses · actions logged UNASSIGNED · approval gate · audit log`, [feedbackForm, storeFeedback, pmForm, settings], { color: 5 });

export default workflow('retro-synthesizer', 'AI Proposes, PM Decides: 05 Retro Synthesizer')
  .add(feedbackForm)
  .to(storeFeedback)
  .add(pmForm)
  .to(settings)
  .to(readFeedback)
  .to(prepare)
  .to(enoughCheck
    .onTrue(retroAgent.to(formatApproval.to(approvalGate.to(isApproved
      .onTrue(summaryDraft.to(logApproved.to(splitActions.to(insertActions))))
      .onFalse(logRejected)))))
    .onFalse(notEnough))
  .add(note)
  .group('Collect', [storeFeedback], { description: 'Anonymous team feedback is stored as it arrives. No names or emails are collected.' })
  .group('Check', [settings, readFeedback, prepare, enoughCheck], { description: 'Reads feedback for the chosen retro and enforces the minimum-responses anonymity rule' })
  .group('Propose', [retroAgent, retroModel, retroParser, formatApproval], { description: 'Retro Analyst groups themes, flags recurring issues, proposes actions, drafts the team summary' })
  .group('PM decides', [approvalGate, isApproved], { description: 'Approve or reject by email. Nothing is logged before this point.' })
  .group('Act and log', [summaryDraft, logApproved, splitActions, insertActions], { description: 'Only after approval: team summary draft, actions logged as UNASSIGNED, audit entry' });
