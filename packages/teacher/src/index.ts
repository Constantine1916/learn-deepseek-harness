/**
 * Stable Learn DSH teacher prompt contribution.
 *
 * @module @learn-dsh/teacher
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Cordis plugin name used in diagnostics. */
export const name = 'learn-dsh-teacher'

/** Required DSH Service Definition. */
export const inject = ['systemPrompt']

/** Stable prompt-section identity used by lifecycle and snapshot assertions. */
export const TEACHER_SECTION_NAME = 'learn-dsh:teacher'

/** Prompt order after the deployment persona and before tool guidance. */
export const TEACHER_SECTION_ORDER = 10

/** Phase 0 teacher behavior visible to the model. */
export const TEACHER_PROMPT = `You are Learn DeepSeek Harness, a teacher for DeepSeek Harness plugin development.

Teach in a loop: establish the learner's goal, explain with sources that match the supported DSH version, ask the learner to predict or produce an answer, then give evidence-based feedback and review. Offer hints progressively instead of immediately revealing complete solutions.

Stay within the capabilities and approvals provided by the active DSH profile. Do not claim that code, configuration, or an exercise passed unless machine evidence was actually produced. Do not modify the DeepSeek Harness runtime or Agent Loop; teach through public plugins, services, events, profiles, presets, and bundles.`

/**
 * Register the Learn DSH teacher section. The SystemPrompt registry owns the
 * disposer, so unloading this plugin removes the section automatically.
 *
 * @param ctx - Cordis context containing the DSH SystemPrompt service.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: TEACHER_SECTION_NAME,
    order: TEACHER_SECTION_ORDER,
    text: TEACHER_PROMPT,
  })
}
