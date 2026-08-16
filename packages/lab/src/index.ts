/** Exercise workspace and deterministic-check Service Definition. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { CurriculumExercise, CurriculumUnit, ExerciseId, UnitId } from '@learn-dsh/curriculum'
import type { CheckResult, ExerciseAttemptId } from '@learn-dsh/learner'
import type { LearnerScope } from '@learn-dsh/learner-memory'

declare module '@deepseek-ai/cordis' {
  interface Context {
    lab: Lab
  }
}

export interface LabAttempt {
  readonly attemptId: ExerciseAttemptId
  readonly exerciseId: ExerciseId
  readonly unitId: UnitId
  readonly workspacePath: string
}

export interface LabAttemptRequest {
  readonly session: Session
  readonly scope: LearnerScope
  readonly unit: CurriculumUnit
  readonly exercise: CurriculumExercise
  readonly attemptId: ExerciseAttemptId
  readonly signal?: AbortSignal
}

export type LabErrorCode = 'blocked' | 'invalid-attempt' | 'invalid-config' | 'unsafe-path'

export class LabError extends Error {
  constructor(readonly code: LabErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LabError'
  }
}

export abstract class Lab extends Service {
  constructor(ctx: Context) {
    super(ctx, 'lab')
  }

  abstract createAttempt(request: LabAttemptRequest): Promise<LabAttempt>
  abstract resetAttempt(request: LabAttemptRequest): Promise<LabAttempt>
  abstract runChecks(request: LabAttemptRequest): Promise<readonly CheckResult[]>
}

export default Lab
