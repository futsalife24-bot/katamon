const { test } = require('node:test');
const assert = require('node:assert/strict');
const { approvalMode } = require('../tools/registration/approval-policy.cjs');

const reviewers = { protection_rules: [{ type: 'required_reviewers', prevent_self_review: true, reviewers: [{ type: 'User', reviewer: { login: 'owner' } }] }] };

test('keeps independent approval as the default', () => {
  assert.equal(approvalMode(reviewers, 'independent'), 'independent');
});

test('single-operator mode still requires a configured reviewer and explicit self-review permission', () => {
  const single = structuredClone(reviewers);
  single.protection_rules[0].prevent_self_review = false;
  assert.equal(approvalMode(single, 'single-operator'), 'single-operator');
  assert.throws(() => approvalMode(single, 'independent'), /environmentApprovalMissing/);
  assert.throws(() => approvalMode({ protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [] }] }, 'single-operator'), /environmentApprovalMissing/);
});

test('missing or incompatible protection never enables activation', () => {
  assert.throws(() => approvalMode({}, 'single-operator'), /environmentApprovalMissing/);
  assert.throws(() => approvalMode(reviewers, 'single-operator'), /environmentApprovalMissing/);
});
