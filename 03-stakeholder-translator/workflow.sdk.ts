import { workflow, node, trigger, sticky, ifElse, languageModel, outputParser, expr } from '@n8n/workflow-sdk';

// ---------- Input: the PM fills in this form ----------
const updateForm = trigger({
  type: 'n8n-nodes-base.formTrigger',
  version: 2.6,
  config: {
    name: 'PM Input Form',
    parameters: {
      formTitle: 'Stakeholder Translator',
      formDescription: 'Paste one update. The agent rewrites it for each audience you pick, then checks the client version for anything internal. You approve before any draft is saved.',
      formFields: {
        values: [
          { fieldLabel: 'Project name', fieldName: 'projectName', fieldType: 'text', placeholder: 'e.g. Project Atlas', requiredField: true },
          { fieldLabel: 'The update (raw notes, status report, anything)', fieldName: 'update', fieldType: 'textarea', placeholder: 'Paste what happened this week', requiredField: true },
          { fieldLabel: 'Internal only: must NOT reach the client', fieldName: 'internalOnly', fieldType: 'textarea', placeholder: 'e.g. budget overrun, staffing problems, vendor dispute, internal blame' },
          { fieldLabel: 'Audiences', fieldName: 'audiences', fieldType: 'checkbox', fieldOptions: { values: [{ option: 'Executive' }, { option: 'Team' }, { option: 'Client' }] }, requiredField: true },
          { fieldLabel: 'Client name (if writing to a client)', fieldName: 'clientName', fieldType: 'text', placeholder: 'e.g. Northwind Retail' },
          { fieldLabel: 'Executive recipients', fieldName: 'execTo', fieldType: 'text', placeholder: 'emails, comma separated (optional)' },
          { fieldLabel: 'Team recipients', fieldName: 'teamTo', fieldType: 'text', placeholder: 'emails, comma separated (optional)' },
          { fieldLabel: 'Client recipients', fieldName: 'clientTo', fieldType: 'text', placeholder: 'emails, comma separated (optional)' }
        ]
      },
      responseMode: 'onReceived',
      options: {
        buttonLabel: 'Translate',
        path: 'stakeholder-translator',
        appendAttribution: false,
        respondWithOptions: { values: { respondWith: 'text', formSubmittedText: 'Got it. Your versions will arrive by email for approval in about a minute.' } }
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
      jsCode: `const f = $input.first().json;
const emails = (s) => String(s || '').split(/[,;\\s]+/).map(x => x.trim()).filter(x => x.includes('@'));
let aud = f.audiences;
if (typeof aud === 'string') aud = aud.split(',');
aud = (aud || []).map(a => String(a).trim()).filter(Boolean);
return [{ json: {
  projectName: String(f.projectName || '').trim(),
  update: String(f.update || '').trim().slice(0, 30000),
  internalOnly: String(f.internalOnly || '').trim(),
  audiences: aud,
  wantExec: aud.includes('Executive'),
  wantTeam: aud.includes('Team'),
  wantClient: aud.includes('Client'),
  clientName: String(f.clientName || 'the client').trim() || 'the client',
  recipients: { Executive: emails(f.execTo), Team: emails(f.teamTo), Client: emails(f.clientTo) },
  approverEmail: f.approverEmail,
  pauseSeconds: f.pauseSeconds
} }];`
    }
  }
});

// ---------- Propose ----------
const GEMINI = { googlePalmApi: { id: 'YOUR_GEMINI_CREDENTIAL_ID', name: 'Google Gemini' } };
const MODEL = 'models/gemini-3-flash-preview';

const translateModel = languageModel({ type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', version: 1.2, config: { name: 'Gemini: Translate', parameters: { modelName: MODEL, options: { temperature: 0.3 } }, credentials: GEMINI } });
const checkModel = languageModel({ type: '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', version: 1.2, config: { name: 'Gemini: Leak Check', parameters: { modelName: MODEL, options: { temperature: 0 } }, credentials: GEMINI } });

const translateParser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured', version: 1.3,
  config: { name: 'Versions Structure', parameters: { schemaType: 'fromJson', jsonSchemaExample: '{ "executive": { "subject": "Subject", "body": "Body" }, "team": { "subject": "Subject", "body": "Body" }, "client": { "subject": "Subject", "body": "Body" } }' } }
});

const checkParser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured', version: 1.3,
  config: { name: 'Leak Check Structure', parameters: { schemaType: 'fromJson', jsonSchemaExample: '{ "clientSafe": true, "issues": [{ "audience": "Client", "problem": "Mentions the budget overrun, which is internal only", "quote": "we are 12% over budget" }], "factChanges": [{ "audience": "Executive", "problem": "Says the dry run is on time; the update says it slipped 7 days" }] }' } }
});

const translator = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm', version: 1.9,
  config: {
    name: 'Translator',
    parameters: {
      promptType: 'define',
      text: expr('You are a senior PM\'s communications specialist. Rewrite ONE project update for different audiences. Same facts, different framing. Never invent facts, dates or numbers.\n\nWrite ONLY the versions marked YES. For versions marked NO return an empty subject and body.\n\nEXECUTIVE ({{ $json.wantExec ? "YES" : "NO" }}): under 120 words. Lead with status and the one thing they must know or decide. Business impact, not task detail. Ask for a decision explicitly if one is needed.\nTEAM ({{ $json.wantTeam ? "YES" : "NO" }}): under 200 words. What changed, who does what next, dates. Direct and practical. Recognise good work where the update mentions it.\nCLIENT ({{ $json.wantClient ? "YES" : "NO" }}) for {{ $json.clientName }}: under 150 words. Professional and calm. What they will see, what we are doing, what we need from them. NEVER include anything from the INTERNAL ONLY section, internal blame, staffing problems, internal budget figures or vendor disputes.\n\nPlain text, short paragraphs. Sign off as "The {{ $json.projectName }} team".\n\nPROJECT: {{ $json.projectName }}\n\nTHE UPDATE:\n{{ $json.update }}\n\nINTERNAL ONLY (use for exec and team if relevant; NEVER for client):\n{{ $json.internalOnly || "None given" }}'),
      hasOutputParser: true
    },
    subnodes: { model: translateModel, outputParser: translateParser }
  }
});

const pace = node({ type: 'n8n-nodes-base.wait', version: 1.1, config: { name: 'Pace', parameters: { resume: 'timeInterval', amount: expr('{{ $("Prepare Input").first().json.pauseSeconds }}'), unit: 'seconds' } } });

const leakCheck = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm', version: 1.9,
  config: {
    name: 'Leak Checker',
    parameters: {
      promptType: 'define',
      text: expr('You are a strict reviewer. Check the drafted versions below against the sources.\n\nVALID SOURCES: the SOURCE UPDATE is valid for every audience. The INTERNAL ONLY notes are valid for the Executive and Team versions, so do NOT flag internal facts that appear there. Internal facts are only a problem in the Client version.\n\n1. CLIENT LEAKS: does the client version contain anything from INTERNAL ONLY, or internal blame, staffing problems, internal budget figures, or vendor disputes? Quote the exact words. If there is no client version, clientSafe is true.\n2. FACT CHANGES: does any version state something that contradicts its valid sources, or add a fact (date, number, commitment) that is in neither valid source? List each one.\n\nBe precise. Do not flag tone or style. Empty lists if nothing is wrong.\n\nSOURCE UPDATE:\n{{ $("Prepare Input").first().json.update }}\n\nINTERNAL ONLY:\n{{ $("Prepare Input").first().json.internalOnly || "None given" }}\n\nDRAFTED VERSIONS:\n{{ JSON.stringify($("Translator").first().json.output) }}'),
      hasOutputParser: true
    },
    subnodes: { model: checkModel, outputParser: checkParser }
  }
});

const formatApproval = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Format Proposal for PM',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const v = $('Translator').first().json.output;
const chk = $input.first().json.output || {};
const inp = $('Prepare Input').first().json;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const issues = (chk.issues || []).concat((chk.factChanges || []).map(x => ({ audience: x.audience, problem: 'Fact check: ' + x.problem, quote: '' })));
const card = (label, key, want) => {
  if (!want) return '';
  const x = v[key] || {};
  const to = inp.recipients[label] || [];
  const mine = issues.filter(i => String(i.audience).toLowerCase() === label.toLowerCase());
  return '<h3 style="margin-bottom:4px">' + label + (mine.length ? ' <span style="color:#b00020">⚠ ' + mine.length + ' flag(s)</span>' : ' <span style="color:#1e7e34">✓ no flags</span>') + '</h3>'
    + '<p style="font-size:12px;color:#666;margin:0">Draft to: ' + (to.length ? esc(to.join(', ')) : 'no recipients yet (add them in Outlook)') + '</p>'
    + '<div style="border-left:3px solid #ccc;padding:6px 12px;background:#fafafa;margin:6px 0"><b>' + esc(x.subject) + '</b><br>' + esc(x.body).replace(/\\n/g, '<br>') + '</div>'
    + (mine.length ? '<ul style="color:#b00020">' + mine.map(i => '<li>' + esc(i.problem) + (i.quote ? ': <i>"' + esc(i.quote) + '"</i>' : '') + '</li>').join('') + '</ul>' : '');
};
const banner = issues.length
  ? '<p style="background:#fdecea;border-left:4px solid #b00020;padding:8px 12px"><b>The leak checker raised ' + issues.length + ' flag(s).</b> Read them before approving. If a flag is real, reject and resubmit with clearer internal-only notes.</p>'
  : '<p style="background:#e8f5e9;border-left:4px solid #1e7e34;padding:8px 12px">Leak checker: no internal information found in the client version and no fact changes.</p>';
const html = '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#222;max-width:760px">'
  + '<p style="font-size:12px;letter-spacing:1px;color:#b00020;margin:0">AI PROPOSES · YOU DECIDE</p>'
  + '<h2 style="margin:4px 0">' + esc(inp.projectName) + ': update for ' + esc(inp.audiences.join(', ')) + '</h2>'
  + banner
  + card('Executive', 'executive', inp.wantExec)
  + card('Team', 'team', inp.wantTeam)
  + card('Client', 'client', inp.wantClient)
  + '<p style="font-size:12px;color:#666">Nothing has been saved yet. Approve to save each version as an Outlook draft (never sent automatically). Reject to discard. Your decision is logged either way.</p>'
  + '</div>';
return [{ json: { subject: '[Approval needed] ' + inp.projectName + ' update for ' + inp.audiences.join(', ') + (issues.length ? ' (' + issues.length + ' flag(s))' : ''), html, flags: issues.length } }];`
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
      approvalOptions: { values: { approvalType: 'double', approveLabel: 'Approve and save drafts', disapproveLabel: 'Reject' } },
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
const splitVersions = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: {
    name: 'Split Approved Versions',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const v = $('Translator').first().json.output;
const inp = $('Prepare Input').first().json;
const out = [];
if (inp.wantExec && v.executive && v.executive.body) out.push({ json: { audience: 'Executive', subject: v.executive.subject, body: v.executive.body, to: inp.recipients.Executive.join(',') } });
if (inp.wantTeam && v.team && v.team.body) out.push({ json: { audience: 'Team', subject: v.team.subject, body: v.team.body, to: inp.recipients.Team.join(',') } });
if (inp.wantClient && v.client && v.client.body) out.push({ json: { audience: 'Client', subject: v.client.subject, body: v.client.body, to: inp.recipients.Client.join(',') } });
return out;`
    }
  }
});

const saveDrafts = node({
  type: 'n8n-nodes-base.microsoftOutlook', version: 2,
  config: {
    name: 'Write-back: Save Drafts',
    parameters: {
      resource: 'draft',
      operation: 'create',
      subject: expr('{{ $json.subject }}'),
      bodyContent: expr('{{ $json.body }}'),
      additionalFields: { bodyContentType: 'Text', toRecipients: expr('{{ $json.to }}') }
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
    executeOnce: true,
    parameters: {
      resource: 'row', operation: 'insert',
      dataTableId: { __rl: true, mode: 'name', value: 'pmd_audit_log' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          run_id: expr('{{ $execution.id }}'),
          specialist: 'Translator + Leak Checker',
          proposal: expr('{{ $("Prepare Input").first().json.projectName }} update for {{ $("Prepare Input").first().json.audiences.join(", ") }}'),
          decision: 'Approved',
          decided_by: 'PM',
          write_back: expr('{{ $("Split Approved Versions").all().length }} draft(s) saved; leak-check flags at approval: {{ $("Format Proposal for PM").first().json.flags }}')
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
          specialist: 'Translator + Leak Checker',
          proposal: expr('{{ $("Prepare Input").first().json.projectName }} update for {{ $("Prepare Input").first().json.audiences.join(", ") }}'),
          decision: 'Rejected (or no response in 2 days)',
          decided_by: 'PM',
          write_back: 'None'
        },
        schema: AUDIT_SCHEMA
      }
    }
  }
});

const note = sticky(`## 03 · Stakeholder Translator
**PM input:** open the form, paste one update, list anything **internal only**, pick audiences (Executive, Team, Client).

The **Translator** writes each version: same facts, different framing. The **Leak Checker** then reviews them: does the client version contain anything internal, and did any version change a fact? You see all versions and every flag in one approval email.

**Guardrails:** internal-only field · independent leak check · fact-change check · drafts only, never auto-sent · audit log`, [updateForm, settings, prepare], { color: 5 });

export default workflow('stakeholder-translator', 'AI Proposes, PM Decides: 03 Stakeholder Translator')
  .add(updateForm)
  .to(settings)
  .to(prepare)
  .to(translator)
  .to(pace)
  .to(leakCheck)
  .to(formatApproval)
  .to(approvalGate)
  .to(isApproved
    .onTrue(splitVersions.to(saveDrafts.to(logApproved)))
    .onFalse(logRejected))
  .add(note)
  .group('Input', [settings, prepare], { description: 'Takes the PM form input, adds settings, tidies audiences and recipients' })
  .group('Propose', [translator, translateModel, translateParser, pace, leakCheck, checkModel, checkParser, formatApproval], { description: 'Translator writes each version; Leak Checker flags internal info in the client version and fact changes' })
  .group('PM decides', [approvalGate, isApproved], { description: 'Approve or reject by email. Nothing is saved before this point.' })
  .group('Act and log', [splitVersions, saveDrafts, logApproved], { description: 'Only after approval: one Outlook draft per audience, then an audit entry' });
