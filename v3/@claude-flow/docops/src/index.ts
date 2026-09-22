/**
 * @claude-flow/docops — typed record substrate (T3, agentic SDLC plan).
 * @module index
 */

export {
  RECORD_PREFIXES,
  RecordIdSchema,
  ProvenanceSchema,
  ContentHashSchema,
  type RecordKind,
  type Provenance,
} from './schemas/base.js';

export {
  RequirementSchema,
  RequirementStatusSchema,
  type Requirement,
  type RequirementStatus,
} from './schemas/requirement.js';

export {
  DecisionSchema,
  DecisionStatusSchema,
  type Decision,
  type DecisionStatus,
} from './schemas/decision.js';

export {
  TaskSchema,
  TaskObjectSchema,
  TaskStatusSchema,
  TaskPrioritySchema,
  EstimateSchema,
  ActualsSchema,
  DoneCriteriaSchema,
  BlockedSchema,
  type Task,
  type TaskStatus,
  type TaskPriority,
  type Estimate,
  type Actuals,
  type DoneCriteria,
  type Blocked,
} from './schemas/task.js';

export { computeContentHash } from './content-hash.js';

export {
  parseRecordFile,
  serializeRecordFile,
  validateRecord,
  validateRecordFile,
  UnknownRecordKindError,
  ContentHashMismatchError,
  ReadabilityError,
  type AnyRecord,
  type ParsedRecordFile,
  type ValidateResult,
} from './frontmatter.js';

export {
  validateReadability,
  type ReadabilityRule,
  type ReadabilityIssue,
  type ReadabilityResult,
  type ReadabilityOptions,
} from './validators/readability.js';

export {
  TASK_STATES,
  nextState,
  attemptTransition,
  resumeFromBlocked,
  isLegalTransition,
  type TaskState,
  type ResumableState,
  type BlockedInfo,
  type TransitionContext,
  type TransitionResult,
  type CitationAcceptance,
} from './state-machine.js';
