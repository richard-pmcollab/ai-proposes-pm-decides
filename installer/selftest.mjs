#!/usr/bin/env node
// Tests install.mjs against a stand-in n8n API on this computer. No API key, no n8n account, nothing sent online.
//
//   node installer/selftest.mjs
//
// It runs the installer twice: once against an n8n that accepts canvas groups and MCP access, and once
// against one that rejects unknown fields (like older versions). Then it checks what the installer sent.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'selftest-key', EMAIL = 'selftest@example.com';
const ALLOWED_WF = ['name', 'nodes', 'connections', 'settings', 'staticData'];
const ALLOWED_SETTINGS = ['executionOrder', 'saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'callerPolicy'];

function startMock(strict) {
  let n = 1; const id = () => 'm' + (n++);
  const state = {
    creds: [{ id: 'c1', name: 'Gemini', type: 'googlePalmApi', updatedAt: '2026-01-01' }, { id: 'c2', name: 'Outlook', type: 'microsoftOutlookOAuth2Api', updatedAt: '2026-01-01' }],
    tables: [{ id: 'tRaid', name: 'pmd_raid_log', columns: [] }], rows: { tRaid: [{ id: 1, title: 'already here' }] }, workflows: []
  };
  const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      const u = new URL(req.url, 'http://x'), p = u.pathname.replace(/^\/api\/v1/, ''), b = body ? JSON.parse(body) : null;
      if (req.headers['x-n8n-api-key'] !== KEY) return send(res, 401, { message: 'unauthorized' });
      let m;
      if (req.method === 'GET' && p === '/credentials') return send(res, 200, { data: state.creds, nextCursor: null });
      if (req.method === 'GET' && p === '/data-tables') return send(res, 200, { data: state.tables, nextCursor: null });
      if (req.method === 'POST' && p === '/data-tables') { const t = { id: id(), ...b }; state.tables.push(t); state.rows[t.id] = []; return send(res, 201, t); }
      if ((m = p.match(/^\/data-tables\/([^/]+)\/rows$/))) {
        if (req.method === 'GET') return send(res, 200, { data: state.rows[m[1]].slice(0, 1), nextCursor: null });
        state.rows[m[1]].push(...b.data); return send(res, 200, b.data.length);
      }
      if (req.method === 'GET' && p === '/workflows') return send(res, 200, { data: state.workflows, nextCursor: null });
      if (req.method === 'POST' && p === '/workflows') {
        const extra = Object.keys(b).filter(k => !ALLOWED_WF.includes(k)).concat(Object.keys(b.settings || {}).filter(k => !ALLOWED_SETTINGS.includes(k)));
        if (strict && extra.length) return send(res, 400, { message: 'must NOT have additional properties: ' + extra.join(',') });
        const w = { id: id(), ...b }; state.workflows.push(w); return send(res, 200, w);
      }
      send(res, 404, { message: 'not found' });
    });
  });
  return new Promise(r => server.listen(0, () => r({ server, state, port: server.address().port })));
}

const runInstaller = (port, key) => new Promise(r => {
  const p = spawn(process.execPath, [join(ROOT, 'installer', 'install.mjs'), '--url', 'http://localhost:' + port, '--email', EMAIL],
    { env: { ...process.env, N8N_API_KEY: key }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  p.on('close', code => r({ code, out }));
});

let failed = 0;
const check = (ok, label) => { console.log((ok ? '  ✅ ' : '  ❌ ') + label); if (!ok) failed++; };
const lastInstall = join(ROOT, 'installer', 'last-install.json');
// The installer writes last-install.json; keep the one from your real install, if any.
const savedLastInstall = existsSync(lastInstall) ? readFileSync(lastInstall, 'utf8') : null;
const setup = JSON.parse(readFileSync(join(ROOT, '00-setup', 'workflow.json'), 'utf8'));
const tableCount = setup.nodes.filter(x => x.parameters && x.parameters.resource === 'table' && x.parameters.operation === 'create').length;

for (const strict of [false, true]) {
  console.log('\n' + (strict ? 'n8n that rejects unknown fields' : 'Current n8n'));
  const { server, state, port } = await startMock(strict);
  const { code, out } = await runInstaller(port, KEY);
  server.close();
  const txt = JSON.stringify(state.workflows);
  let unwired = 0;
  for (const w of state.workflows) for (const x of w.nodes) {
    if (/lmChatGoogleGemini$/.test(x.type) && x.credentials?.googlePalmApi?.id !== 'c1') unwired++;
    if (/microsoftOutlook$/.test(x.type) && x.credentials?.microsoftOutlookOAuth2Api?.id !== 'c2') unwired++;
  }
  check(code === 0, 'installer finished without errors');
  check(state.tables.length === tableCount, `all ${tableCount} data tables exist`);
  check(state.rows.tRaid.length === 1, 'a table that already has data is left alone');
  check(state.workflows.length === 7, '7 agents imported');
  check(unwired === 0, 'every Gemini and Outlook node uses your credentials');
  check(!txt.includes('YOUR_EMAIL@example.com') && txt.includes(EMAIL), 'your email replaces the placeholder');
  check(state.workflows.every(w => strict ? !w.nodeGroups : w.settings.availableInMCP === true), strict ? 'falls back to a plain import' : 'agents are marked "Available in MCP"');
  if (code !== 0) console.log(out);
}

console.log('\nWrong API key');
{
  const { server, port } = await startMock(false);
  const { code, out } = await runInstaller(port, 'wrong');
  server.close();
  check(code !== 0 && /rejected the API key/.test(out), 'stops with a clear message');
}
if (savedLastInstall !== null) writeFileSync(lastInstall, savedLastInstall);
else if (existsSync(lastInstall)) unlinkSync(lastInstall);
console.log('\n' + (failed ? `${failed} check(s) failed.` : 'All checks passed.') + '\n');
process.exit(failed ? 1 : 0);
