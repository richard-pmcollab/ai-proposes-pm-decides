#!/usr/bin/env node
// Checks a filled-in pm-inputs.md before anything is sent to n8n or the AI.
// Rules, not AI: the same file always gives the same result.
//
//   node inputs/check-inputs.mjs inputs/my-project/pm-inputs.md
//   node inputs/check-inputs.mjs inputs/my-project/pm-inputs.md --json inputs/my-project/checked.json
//
// Exit code 0 = ready to run, 1 = fix the errors first. --json writes the parsed inputs
// (without the Privacy check names) for the run-pm-agents skill to load.
import fs from 'node:fs';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
if (!file) { console.error('Usage: node inputs/check-inputs.mjs <path to pm-inputs.md> [--json out.json]'); process.exit(2); }
if (!fs.existsSync(file)) { console.error('File not found: ' + file); process.exit(2); }

const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const text = raw.replace(/<!--[\s\S]*?-->/g, '');
const errors = [], warnings = [], notes = [];
const err = (s) => errors.push(s), warn = (s) => warnings.push(s), note = (s) => notes.push(s);

// ---- Parsing ---------------------------------------------------------------------------------
function sections(src, level) {
  const re = new RegExp('^' + '#'.repeat(level) + ' (.+)$', 'gm');
  const out = {}; let m, last = null, idx = [];
  while ((m = re.exec(src))) idx.push({ name: m[1].trim(), start: m.index, bodyStart: m.index + m[0].length });
  idx.forEach((s, i) => { out[s.name.toLowerCase()] = src.slice(s.bodyStart, i + 1 < idx.length ? idx[i + 1].start : src.length); });
  return out;
}
const top = sections(text, 2);
const sec = (name) => top[name.toLowerCase()] || '';
const beforeSub = (body) => body.split(/^### /m)[0];
const fields = (body) => {
  const out = {};
  for (const line of beforeSub(body).split('\n')) {
    const m = line.match(/^- ([^:|]+):\s*(.*)$/);
    if (m) out[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return out;
};
const bullets = (body) => body.split('\n').map(l => l.match(/^- (.+)$/)).filter(Boolean).map(m => m[1].trim()).filter(Boolean);
function table(body) {
  const lines = beforeSub(body).split('\n').filter(l => l.trim().startsWith('|'));
  if (lines.length < 2) return [];
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const head = cells(lines[0]).map(h => h.toLowerCase());
  return lines.slice(2).map(cells).filter(r => r.some(Boolean)).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] || ''])));
}
function block(body, subName) {
  const sub = sections(body, 3)[subName.toLowerCase()];
  if (sub === undefined) return '';
  const fence = sub.match(/```[a-z]*\n([\s\S]*?)```/);
  return (fence ? fence[1] : sub).trim();
}

// ---- Value rules -----------------------------------------------------------------------------
const today = new Date(); today.setHours(0, 0, 0, 0);
const todayIso = today.toISOString().slice(0, 10);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00'));
const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
const isNum = (s) => s !== '' && !isNaN(Number(String(s).replace(/[, ]/g, '')));
const toNum = (s) => Number(String(s).replace(/[, ]/g, ''));
const oneOf = (v, list) => list.find(x => x.toLowerCase() === String(v).trim().toLowerCase());

// ---- Privacy check ---------------------------------------------------------------------------
const privacyNames = bullets(sec('Privacy check')).filter(n => n.length >= 3);
const withoutPrivacy = text.replace(/^## Privacy check$[\s\S]*?(?=^## )/m, '');
const lines = withoutPrivacy.split('\n');
for (const name of privacyNames) {
  const hits = lines.map((l, i) => l.toLowerCase().includes(name.toLowerCase()) ? i : -1).filter(i => i >= 0);
  if (hits.length) err(`Privacy: "${name}" appears ${hits.length} time(s). Replace it with a code name.`);
}
if (!privacyNames.length) warn('Privacy check is empty. Add the real client, vendor and colleague names so the checker can catch them.');
if (/Project Atlas/i.test(withoutPrivacy)) warn('The file still contains the "Project Atlas" example. Replace the example rows with your own project.');

// ---- Project ---------------------------------------------------------------------------------
const pf = fields(sec('Project'));
const project = {
  name: pf['name'] || '', sponsor: pf['sponsor'] || '', phase: pf['phase'] || '',
  budget_planned: pf['budget planned'] || '', budget_spent: pf['budget spent'] || '',
  go_live: pf['end date'] || '', team_notes: bullets(sections(sec('Project'), 3)['team notes'] || '').join('\n')
};
const approverEmail = pf['approver email'] || '';
if (!project.name) err('Project: Name is required.');
if (!isNum(project.budget_planned) || toNum(project.budget_planned) <= 0) err('Project: Budget planned must be a number above 0 (a percentage like 100 is fine if you do not share money figures).');
if (!isNum(project.budget_spent)) err('Project: Budget spent must be a number.');
if (!isDate(project.go_live)) err('Project: End date must be YYYY-MM-DD.');
else if (project.go_live < todayIso) warn('Project: End date is in the past.');
if (!isEmail(approverEmail)) err('Project: Approver email is missing or not an email address.');

// ---- Milestones ------------------------------------------------------------------------------
const milestones = table(sec('Milestones')).map(r => ({ name: r['milestone'], baseline: r['baseline'], forecast: r['forecast'], depends_on: r['depends on'] || '', status: oneOf(r['status'] || '', ['Done']) || (r['status'] || '') }));
const msNames = new Set(milestones.map(m => m.name));
if (!milestones.length) err('Milestones: add at least one milestone. Agent Team, 01 and 06 need them.');
milestones.forEach((m, i) => {
  const at = `Milestones row ${i + 1} (${m.name || 'no name'})`;
  if (!m.name) err(at + ': name is required.');
  if (!isDate(m.baseline)) err(at + ': Baseline must be YYYY-MM-DD.');
  if (!isDate(m.forecast)) err(at + ': Forecast must be YYYY-MM-DD.');
  if (m.depends_on && !msNames.has(m.depends_on)) err(at + `: "Depends on" (${m.depends_on}) does not match any milestone name.`);
  if (m.status && m.status !== 'Done') err(at + ': Status must be empty (open) or Done.');
  if (!m.status && isDate(m.forecast) && m.forecast < todayIso) warn(at + ': the forecast date has passed. If it is finished, set Status to Done; otherwise update the forecast.');
});

// ---- Tasks -----------------------------------------------------------------------------------
const STATUSES = ['Not Started', 'In Progress', 'Blocked', 'Done'];
const tasks = table(sec('Tasks')).map(r => ({
  task_id: r['id'], task: r['task'], owner: r['owner'], workstream: r['workstream'], due: r['due'],
  progress: r['progress %'], status: oneOf(r['status'], STATUSES) || r['status'], critical: r['critical'],
  blocker: r['blocker'], milestone: r['milestone']
}));
if (!tasks.length) err('Tasks: add at least one task. Agent Team, 01 and 06 need them.');
const ids = new Set();
tasks.forEach((t, i) => {
  const at = `Tasks row ${i + 1} (${t.task_id || t.task || 'no id'})`;
  if (!t.task_id) err(at + ': ID is required.'); else if (ids.has(t.task_id)) err(at + ': ID is used twice.'); ids.add(t.task_id);
  if (!t.task) err(at + ': Task is required.');
  if (!t.owner) err(at + ': Owner is required.');
  if (!isDate(t.due)) err(at + ': Due must be YYYY-MM-DD.');
  if (!isNum(t.progress) || toNum(t.progress) < 0 || toNum(t.progress) > 100) err(at + ': Progress % must be 0 to 100.');
  if (!STATUSES.includes(t.status)) err(at + ': Status must be one of ' + STATUSES.join(', ') + '.');
  if (!oneOf(t.critical, ['Yes', 'No'])) err(at + ': Critical must be Yes or No.');
  if (t.status === 'Blocked' && !t.blocker) err(at + ': a Blocked task needs a Blocker.');
  if (t.status === 'Done' && isNum(t.progress) && toNum(t.progress) < 100) warn(at + ': Done but progress is below 100%.');
  if (t.milestone && !msNames.has(t.milestone)) err(at + `: Milestone (${t.milestone}) does not match any milestone name.`);
});
const open = tasks.filter(t => t.status !== 'Done' && isDate(t.due));
const overdue = open.filter(t => t.due < todayIso);
if (overdue.length) warn(`Tasks: ${overdue.length} open task(s) are past their due date and will be reported as overdue: ${overdue.map(t => t.task_id).join(', ')}. Correct the dates if that is not real.`);
if (open.length && overdue.length === open.length) warn('Tasks: every open task is overdue. Are these old dates?');

// ---- Risks and issues ------------------------------------------------------------------------
const HML = ['High', 'Medium', 'Low'];
const raid = table(sec('Risks and issues')).map(r => ({
  raid_type: oneOf(r['type'], ['Risk', 'Assumption', 'Issue', 'Dependency']) || r['type'], title: r['title'],
  impact: oneOf(r['impact'], HML) || r['impact'], likelihood: oneOf(r['likelihood'], HML) || r['likelihood'],
  owner: r['owner'], mitigation: r['mitigation'], status: 'Open', source: 'PM inputs ' + todayIso
}));
raid.forEach((r, i) => {
  const at = `Risks row ${i + 1} (${r.title || 'no title'})`;
  if (!['Risk', 'Assumption', 'Issue', 'Dependency'].includes(r.raid_type)) err(at + ': Type must be Risk, Assumption, Issue or Dependency.');
  if (!r.title) err(at + ': Title is required.');
  if (!HML.includes(r.impact)) err(at + ': Impact must be High, Medium or Low (a word, not a sentence).');
  if (!HML.includes(r.likelihood)) err(at + ': Likelihood must be High, Medium or Low.');
});

// ---- Meeting ---------------------------------------------------------------------------------
const mf = fields(sec('Meeting'));
const meeting = { meetingName: mf['meeting name'] || '', meetingDate: mf['meeting date'] || '', attendees: mf['attendee emails'] || '', transcript: block(sec('Meeting'), 'Transcript') };
if (meeting.transcript) {
  if (!meeting.meetingName) err('Meeting: Meeting name is required when there is a transcript.');
  if (!isDate(meeting.meetingDate)) err('Meeting: Meeting date must be YYYY-MM-DD.');
  if (meeting.transcript.length < 80) warn('Meeting: the transcript is very short; the agent may find nothing to extract.');
  for (const a of meeting.attendees.split(/[,;\s]+/).filter(Boolean)) if (!isEmail(a)) err(`Meeting: "${a}" is not an email address.`);
}

// ---- Stakeholder update ----------------------------------------------------------------------
const uf = fields(sec('Stakeholder update'));
const AUD = ['Executive', 'Team', 'Client'];
const audiences = (uf['audiences'] || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
const update = { projectName: project.name, update: block(sec('Stakeholder update'), 'Update'), internalOnly: block(sec('Stakeholder update'), 'Internal only'),
  audiences: audiences.map(a => oneOf(a, AUD) || a), clientName: uf['client name'] || '' };
if (update.update) {
  if (!update.audiences.length) err('Stakeholder update: list at least one audience (Executive, Team, Client).');
  update.audiences.forEach(a => { if (!AUD.includes(a)) err(`Stakeholder update: unknown audience "${a}".`); });
  if (update.audiences.includes('Client') && !update.internalOnly) warn('Stakeholder update: a Client version is requested but "Internal only" is empty. The leak checker has nothing to guard.');
}

// ---- Requests --------------------------------------------------------------------------------
const IMPACTS = ['Blocks our work', 'Affects customers or revenue', 'Improvement / nice to have'];
const requests = table(sec('Requests')).map(r => ({ requesterName: r['requester'], requesterEmail: r['email'], department: r['team'], title: r['title'],
  description: r['description'], impact: oneOf(r['impact'], IMPACTS) || r['impact'], neededBy: r['needed by'] || '' }));
requests.forEach((q, i) => {
  const at = `Requests row ${i + 1} (${q.title || 'no title'})`;
  if (!q.requesterName) err(at + ': Requester is required.');
  if (!isEmail(q.requesterEmail)) err(at + ': Email is missing or not an email address.');
  if (!q.title) err(at + ': Title is required.');
  if (!q.description) err(at + ': Description is required.');
  if (!IMPACTS.includes(q.impact)) err(at + ': Impact must be one of: ' + IMPACTS.join(' | ') + '.');
  if (q.neededBy && !isDate(q.neededBy)) err(at + ': Needed by must be YYYY-MM-DD or empty.');
  else if (q.neededBy && q.neededBy < todayIso) warn(at + ': Needed by is in the past.');
});

// ---- Retro -----------------------------------------------------------------------------------
const rf = fields(sec('Retro'));
const retroName = rf['retro name'] || '';
const retro = table(sec('Retro')).map(r => ({ retro: retroName, mood: r['mood 1-5'], went_well: r['went well'], to_improve: r['to improve'], ideas: r['ideas'] }))
  .filter(r => r.went_well || r.to_improve || r.ideas);
if (retro.length) {
  if (!retroName) err('Retro: Retro name is required.');
  retro.forEach((r, i) => { if (!['1', '2', '3', '4', '5'].includes(String(r.mood).trim())) err(`Retro row ${i + 1}: Mood must be 1 to 5.`); });
  if (retro.length < 3) warn(`Retro: only ${retro.length} response(s). The agent needs 3 and will refuse to summarise (that protects anonymity).`);
}

// ---- Run plan --------------------------------------------------------------------------------
const hasTracker = tasks.length && milestones.length;
const plan = [
  ['05 Retro Synthesizer', retro.length ? (retro.length >= 3 ? 1 : 0) : null, retro.length && retro.length < 3 ? 'will refuse: fewer than 3 responses' : ''],
  ['04 Intake Triage', requests.length ? requests.length : null, requests.length ? `${requests.length} request(s)` : ''],
  ['02 Meeting → Actions', meeting.transcript ? 2 : null, ''],
  ['03 Stakeholder Translator', update.update ? 2 : null, ''],
  ['06 Daily Slip Alert', hasTracker ? 1 : null, 'AI only if a milestone moved since the last snapshot'],
  ['PM Agent Team', hasTracker ? 6 : null, ''],
  ['01 Weekly Status', hasTracker ? 1 : null, 'saves an Outlook draft, no approval step']
];
const calls = plan.reduce((s, p) => s + (p[1] || 0), 0);
if (calls > 18) warn(`This run needs up to ${calls} AI requests. The free Gemini tier allows about 20 a day; run it over two days or skip some agents.`);

// ---- Report ----------------------------------------------------------------------------------
console.log('\nPM inputs check: ' + file + '\n');
console.log('Agents:');
for (const [name, n, why] of plan) console.log('  ' + (n === null ? '–  skipped ' : '✓  runs    ') + name + (n ? `  (${n} AI request${n > 1 ? 's' : ''})` : '') + (why ? '  · ' + why : '') + (n === null ? '  · section empty' : ''));
console.log(`\nAI requests: up to ${calls}`);
if (notes.length) { console.log('\nNotes:'); notes.forEach(n => console.log('  • ' + n)); }
if (warnings.length) { console.log('\nWarnings (you can run, but check these):'); warnings.forEach(w => console.log('  ⚠️  ' + w)); }
if (errors.length) { console.log('\nErrors (fix these first):'); errors.forEach(e => console.log('  ❌ ' + e)); }
console.log('\n' + (errors.length ? `Not ready: ${errors.length} error(s).` : 'Ready to run.') + '\n');

if (jsonOut) {
  const batch = new Date().toISOString().slice(0, 16);
  const payload = { checkedAt: new Date().toISOString(), ready: !errors.length, errors, warnings, approverEmail, batch,
    project: { ...project, batch }, tasks: tasks.map(t => ({ ...t, critical: oneOf(t.critical, ['Yes', 'No']) || t.critical, batch })),
    milestones: milestones.map(m => ({ ...m, batch })), raid, meeting, update, requests, retro,
    plan: plan.map(([agent, aiRequests, note]) => ({ agent, runs: aiRequests !== null, aiRequests: aiRequests || 0, note })) };
  fs.writeFileSync(jsonOut, JSON.stringify(payload, null, 2));
  console.log('Parsed inputs written to ' + jsonOut + ' (the Privacy check names are not included).\n');
}
process.exit(errors.length ? 1 : 0);
