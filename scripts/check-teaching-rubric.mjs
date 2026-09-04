import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const snapshot = JSON.parse(await readFile(resolve(root, 'examples/headless/tests/snapshots/headless.expected.json'), 'utf8'))
const failures = []

function requireFact(condition, message) {
  if (!condition) failures.push(message)
}

function journey(label) {
  const found = snapshot.journey.find(entry => entry.label === label)
  requireFact(found !== undefined, `missing journey stage ${label}`)
  return found
}

requireFact(snapshot.prompt.firstResponse.includes('source-backed explanation'), 'teacher introduction does not promise source-grounded explanation')
requireFact(snapshot.prompt.firstResponse.includes('persisted evidence'), 'teacher introduction does not state the persisted-evidence boundary')
requireFact(snapshot.prompt.lessonResponse.includes('0.1.2-rc.1 / a66e47020478'), 'lesson is not tied to the supported DSH baseline')
requireFact(snapshot.prompt.checkpointResponse.includes('in your own words'), 'checkpoint does not preserve learner-authored reasoning')
requireFact(snapshot.prompt.failureResponse.includes('no mastery or completion has been granted'), 'implementation failure can be mistaken for completion')
requireFact(snapshot.prompt.blockedResponse.includes('environment timeout, not failed for implementation'), 'environment block is not distinguished from ability failure')
requireFact(snapshot.prompt.reportResponse.includes('no skipped unit was represented as mastered'), 'report does not preserve skipped versus mastered semantics')

for (const entry of snapshot.journey) {
  requireFact(entry.exactSnapshotInSessionLog === true, `${entry.label} lacks an exact model-visible LearnerState Session Log snapshot`)
}

const novice = journey('novice-diagnostic-submit')
const experienced = journey('experienced-diagnostic-submit')
journey('experienced-skip')
requireFact(novice?.activity?.kind === 'diagnostic', 'novice journey did not run a diagnostic')
requireFact(experienced?.activity?.kind === 'diagnostic', 'experienced journey did not run a diagnostic')
requireFact(snapshot.learnerMemory.experiencedState.unitProgress['plugin-context-service-effect'] === 'skipped', 'experienced learner explicit skip was not preserved')

const failed = journey('failed-check')
const successful = journey('successful-check')
requireFact(failed?.checks?.some(check => check.status === 'failed' && check.category === 'implementation'), 'implementation failure evidence is missing')
requireFact(successful?.checks?.some(check => check.status === 'passed'), 'machine-backed successful check is missing')
requireFact((failed?.completedUnits?.length ?? 0) === 0, 'a failed check granted unit completion')

const hint1 = journey('hint-level-2')
const hint2 = journey('hint-level-3')
const hint3 = journey('exercise-before-failure')
requireFact(hint1?.hints?.map(hint => hint.level).join(',') === '1', 'hint level 1 was not persisted before level 2')
requireFact(hint2?.hints?.map(hint => hint.level).join(',') === '1,2', 'hint levels 1 and 2 were not persisted before level 3')
requireFact(hint3?.hints?.map(hint => hint.level).join(',') === '1,2,3', 'all three hint levels were not persisted in order')

journey('capability-blocked-check')
const blocked = journey('capability-blocked-feedback')
const retried = journey('capability-retry-ready')
requireFact(blocked?.checks?.some(check => check.status === 'blocked' && check.category === 'environment'), 'environment-blocked machine result is missing')
requireFact(blocked?.activity?.attemptId === retried?.activity?.attemptId, 'blocked exercise did not retry the same attempt')

const report = snapshot.learnerMemory.learningReport
requireFact(report.courseCompleted === true, 'final keyless learning report is not course-complete')
requireFact(report.verifiedCapabilities.length === 8, 'final keyless learning report does not verify all eight outcomes')
requireFact(report.skippedUnitIds.length === 0, 'completed learner report unexpectedly contains skipped units')
requireFact(snapshot.learnerMemory.experiencedState.unitProgress['plugin-context-service-effect'] === 'skipped', 'experienced learner skipped state is missing')

if (failures.length > 0) throw new Error(`Keyless teaching rubric failed:\n${failures.join('\n')}`)

process.stdout.write('Keyless teaching rubric passed: source accuracy, evidence boundaries, adaptive paths, hint order, blocked retry, audit snapshots, and report semantics.\n')
