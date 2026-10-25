// The portable decision this consumer hands over: ReviveCheck's decision-evidence
// document (`revivecheck.decision-evidence.v1`), produced from this consumer's own
// policy, binding, the report it retrieved, the reads it made and the evaluation it got.
// A second process reconstructs the decision from it with `src/reconstruct.js`.
import { buildDecisionEvidence } from 'revivecheck/decision';

export function decisionEvidenceFor({ config, run, decision, producer = {} }) {
  if (!run.binding || !run.report || !decision.evaluation) return null; // no evaluation was possible (the report was not retrieved): nothing to reconstruct
  return buildDecisionEvidence({
    producer: { name: config.name, kind: 'consumer', control: config.roles?.operator?.control ?? null, source: run.source, ...producer },
    policy: config.policy, binding: run.binding, report: run.report, evaluation: decision.evaluation, inputs: run.inputs,
    configuredEntry: decision.entry,
    extra: { allowlist: decision.allowlist, attempts: run.attempts, fixture: run.fixture },
  });
}
