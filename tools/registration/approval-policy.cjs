'use strict';

function approvalMode(environment, requestedMode) {
  const required = environment?.protection_rules?.find((rule) => rule?.type === 'required_reviewers');
  if (!required || !Array.isArray(required.reviewers) || required.reviewers.length === 0) {
    throw new Error('publisher.environmentApprovalMissing');
  }
  if (required.prevent_self_review === true && requestedMode === 'independent') return 'independent';
  if (required.prevent_self_review === false && requestedMode === 'single-operator') return 'single-operator';
  throw new Error('publisher.environmentApprovalMissing');
}

module.exports = { approvalMode };
