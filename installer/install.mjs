#!/usr/bin/env node
// One-command installer for "AI Proposes, PM Decides".
// Uses n8n's official public API. No extra packages needed (Node.js 18+).
//
//   node installer/install.mjs
//
// Before running, in n8n: create a Google Gemini credential and a Microsoft Outlook
// credential (sign in), and create an n8n API key (Settings > n8n API).
// The installer never asks for your Gemini key or passwords. It only needs the n8n API key,
// which you type into a hidden prompt (or set N8N_API_KEY).
//
// Options:
//   --url <https://you.app.n8n.cloud>   your n8n address (or N8N_URL)
//   --email <you@example.com>           where decision emails go (or PM_EMAIL)
//   --prefix "TEST "                    add a prefix to workflow names (for trying it safely)
//   --only 04-intake-triage,agent-team  install only some folders
//   --no-demo                           do not add demo data to empty tables
//   --dry-run                           check everything, change nothing

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : fallback; };
const flag = (name) => args.includes('--' + name);

const GEMINI_TYPE = 'googlePalmApi';
const OUTLOOK_TYPE = 'microsoftOutlookOAuth2Api';
const EMAIL_PLACEHOLDER = 'YOUR_EMAIL@example.com';
const ORDER = ['agent-team', '01-weekly-status-agent', '02-meeting-to-actions', '03-stakeholder-translator', '04-intake-triage', '05-retro-synthesizer', '06-daily-slip-alert'];

const c = { ok: (s) => console.log('  ✅ ' + s), info: (s) => console.log('  • ' + s), warn: (s) => console.log('  ⚠️  ' + s), step: (s) => console.log('\n' + s) };

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = function (s) { if (s.includes(question)) rl.output.write(s); else rl.output.write('*'); };
    }
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

function fail(msg) { console.error('\n❌ ' + msg + '\n'); process.exit(1); }

async function main() {
  console.log('\nAI Proposes, PM Decides: installer\n');

  // ---- 1. Inputs -------------------------------------------------------------------------
  let url = (opt('url') || process.env.N8N_URL || '').trim();
  if (!url) url = await ask('Your n8n address (for example https://yourname.app.n8n.cloud): ');
  url = url.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  if (!/^https?:\/\//.test(url)) fail('The n8n address must start with https:// (or http://localhost:5678 for a local n8n).');

  let key = process.env.N8N_API_KEY || '';
  if (!key) key = await ask('Your n8n API key (hidden as you type): ', { hidden: true });
  if (!key) fail('No API key given. Create one in n8n: Settings > n8n API > Create an API key.');

  let email = (opt('email') || process.env.PM_EMAIL || '').trim();
  if (!email) email = await ask('Email address for decision emails: ');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('That does not look like an email address.');

  const prefix = opt('prefix', '');
  const dry = flag('dry-run');
  const only = (opt('only', '') || '').split(',').map(s => s.trim()).filter(Boolean);

  const api = async (method, path, body) => {
    const res = await fetch(url + '/api/v1' + path, {
      method, headers: { 'X-N8N-API-KEY': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) { const e = new Error((data && data.message) || text || res.statusText); e.status = res.status; throw e; }
    return data;
  };
  const listAll = async (path) => {
    const out = []; let cursor = '';
    for (let i = 0; i < 50; i++) {
      const page = await api('GET', path + (path.includes('?') ? '&' : '?') + 'limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      out.push(...(page.data || []));
      if (!page.nextCursor) break; cursor = page.nextCursor;
    }
    return out;
  };

  // ---- 2. Connection + credentials --------------------------------------------------------
  c.step('Step 1 of 4: checking your n8n');
  let creds;
  try { creds = await listAll('/credentials'); }
  catch (e) {
    if (e.status === 401) fail('n8n rejected the API key. Create a new one in Settings > n8n API and try again.');
    if (e.status === 403) fail('This API key cannot list credentials. Use an API key from the owner/admin account (with credential scopes).');
    if (e.status === 404) fail('No n8n API found at ' + url + '. Check the address. Note: the n8n API is not available on the n8n Cloud free trial; use INSTALL.md (manual install) instead.');
    fail('Could not reach n8n: ' + e.message);
  }
  c.ok('Connected to ' + url);

  const pick = (type, label) => {
    const found = creds.filter(x => x.type === type).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    if (!found.length) fail('No ' + label + ' credential found. In n8n create one first (see INSTALL.md, "Before you run the installer"), then run the installer again.');
    if (found.length > 1) c.warn('Found ' + found.length + ' ' + label + ' credentials; using the most recently updated: "' + found[0].name + '".');
    c.ok(label + ' credential: "' + found[0].name + '"');
    return { id: found[0].id, name: found[0].name };
  };
  const gemini = pick(GEMINI_TYPE, 'Google Gemini');
  const outlook = pick(OUTLOOK_TYPE, 'Microsoft Outlook');

  // ---- 3. Data tables + demo data (read from 00-setup/workflow.json: one source of truth) --
  c.step('Step 2 of 4: data tables');
  const setup = JSON.parse(readFileSync(join(ROOT, '00-setup', 'workflow.json'), 'utf8'));
  const tableDefs = setup.nodes.filter(n => n.parameters && n.parameters.resource === 'table' && n.parameters.operation === 'create')
    .map(n => ({ name: n.parameters.tableName, columns: n.parameters.columns.column.map(col => ({ name: col.name, type: col.type })) }));
  const demoCode = setup.nodes.find(n => n.name === 'Demo Data for Empty Tables').parameters.jsCode;
  const demoRows = vm.runInNewContext('(function(){' + demoCode + '})()', { $: () => ({ all: () => [] }) });
  const targetTable = { raid: 'pmd_raid_log', intake: 'pmd_intake_log', retro: 'pmd_retro_feedback', snapshot: 'pmd_milestone_snapshot' };

  const existingTables = await listAll('/data-tables');
  for (const t of tableDefs) {
    let table = existingTables.find(x => x.name === t.name);
    if (table) c.info(t.name + ' already exists, kept as it is');
    else if (dry) c.info('[dry run] would create ' + t.name);
    else { table = await api('POST', '/data-tables', t); c.ok('Created ' + t.name); }
    if (!table || flag('no-demo')) continue;
    const rows = demoRows.filter(r => targetTable[r.json.target] === t.name).map(r => { const { target, ...row } = r.json; return row; });
    if (!rows.length) continue;
    const current = await api('GET', '/data-tables/' + table.id + '/rows?limit=1');
    if ((current.data || []).length) { c.info(t.name + ' has data, demo rows skipped'); continue; }
    if (dry) { c.info('[dry run] would add ' + rows.length + ' demo rows to ' + t.name); continue; }
    await api('POST', '/data-tables/' + table.id + '/rows', { data: rows, returnType: 'count' });
    c.ok('Added ' + rows.length + ' demo rows to ' + t.name);
  }

  // ---- 4. Workflows ------------------------------------------------------------------------
  c.step('Step 3 of 4: importing the agents');
  const folders = readdirSync(ROOT).filter(f => ORDER.includes(f) && existsSync(join(ROOT, f, 'workflow.json')))
    .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
    .filter(f => !only.length || only.includes(f));
  const existing = await listAll('/workflows');
  const report = [];
  for (const f of folders) {
    const raw = readFileSync(join(ROOT, f, 'workflow.json'), 'utf8').split(EMAIL_PLACEHOLDER).join(email);
    const wf = JSON.parse(raw);
    const name = prefix + wf.name;
    for (const n of wf.nodes) {
      if (!n.credentials) continue;
      if (n.credentials[GEMINI_TYPE]) n.credentials[GEMINI_TYPE] = gemini;
      if (n.credentials[OUTLOOK_TYPE]) n.credentials[OUTLOOK_TYPE] = outlook;
    }
    const dup = existing.find(x => x.name === name && !x.isArchived);
    if (dup) { c.info('"' + name + '" already exists, skipped (rename or archive it to reinstall)'); report.push({ folder: f, name, id: dup.id, status: 'existing' }); continue; }
    if (dry) { c.info('[dry run] would import "' + name + '"'); continue; }
    const body = { name, nodes: wf.nodes, connections: wf.connections, settings: { executionOrder: 'v1' } };
    if (wf.nodeGroups) body.nodeGroups = wf.nodeGroups;
    let created;
    try { created = await api('POST', '/workflows', body); }
    catch (e) {
      if (body.nodeGroups && e.status === 400) { delete body.nodeGroups; created = await api('POST', '/workflows', body); }
      else throw e;
    }
    c.ok('Imported "' + name + '"');
    report.push({ folder: f, name, id: created.id, url: url + '/workflow/' + created.id, status: 'imported' });
  }

  // ---- 5. Summary --------------------------------------------------------------------------
  c.step('Step 4 of 4: done');
  if (!dry) writeFileSync(join(ROOT, 'installer', 'last-install.json'), JSON.stringify({ n8n: url, email, installedAt: new Date().toISOString(), workflows: report }, null, 2));
  console.log(`
Everything is installed. Your first test (about 2 minutes):
  1. Open "${prefix}AI Proposes, PM Decides: 04 Intake Triage" in n8n${report.find(r => r.folder === '04-intake-triage') ? ':\n     ' + (report.find(r => r.folder === '04-intake-triage').url || url) : ''}
  2. Click "Execute workflow", keep that tab open, and fill in the form that opens.
  3. Open the email in your inbox (check Junk), click "Review and decide", and submit.

The workflows are installed but switched off. When you're happy, click "Publish" in each one.
A summary was saved to installer/last-install.json (no secrets in it).
`);
}

main().catch((e) => fail(e.message || String(e)));
