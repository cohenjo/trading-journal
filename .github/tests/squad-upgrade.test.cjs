const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const { parseRoster, parseRoutingRules, triageIssue } = require('../../.squad/templates/ralph-triage.js');

test('the existing eight specialists retain routing authority', () => {
  const roster = parseRoster(read('.squad/team.md'));
  assert.deepEqual(roster.map(member => member.name), [
    'Keaton', 'Fenster', 'Hockney', 'McManus', 'Kobayashi', 'Kujan', 'Rabin', 'Redfoot',
  ]);
  const rules = parseRoutingRules(read('.squad/routing.md'));
  for (const [title, expected] of [
    ['Docker', 'Kujan'],
    ['React components', 'Fenster'],
    ['FastAPI endpoints', 'Hockney'],
    ['Unclassified request', 'Keaton'],
  ]) {
    assert.equal(triageIssue({ title, body: '' }, rules, [], roster).agent.name, expected);
  }
});

test('fixed support identities are registered without becoming routing destinations', () => {
  const registry = JSON.parse(read('.squad/casting/registry.json'));
  for (const slug of ['rai', 'fact-checker']) {
    assert.equal(registry.agents[slug].universe, 'system');
    assert.equal(registry.agents[slug].status, 'active');
    assert.ok(fs.existsSync(path.join(root, `.squad/agents/${slug}/charter.md`)));
  }
  assert.match(read('.squad/team.md'), /## Support Agents/);
});

test('coordinator preserves canaries and project governance', () => {
  const source = read('.github/agents/squad.agent.md');
  assert.match(source, /SQUAD_COORDINATOR_CANARY_HEAD_b7d2/);
  assert.match(source.trimEnd(), /<!-- SQUAD_COORDINATOR_CANARY_a8f3 -->$/);
  assert.match(source, /### Human Team Members/);
  assert.match(source, /integrates on `main`/);
  assert.doesNotMatch(source, /\| Pre-Ship ceremony \(auto\)/);
  assert.doesNotMatch(source, /Rai enters pair mode/);
});

test('CI does not use unavailable hashFiles in job-level conditions', () => {
  for (const file of ['.github/workflows/pr-backend.yml', '.github/workflows/pr-frontend.yml']) {
    assert.doesNotMatch(read(file), /^    if:.*hashFiles/m, file);
    assert.match(read(file), /^  test:/m, file);
  }
  assert.doesNotMatch(read('.github/workflows/squad-heartbeat.yml'), /^  pull_request_target:/m);
});
