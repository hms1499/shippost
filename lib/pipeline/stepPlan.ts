import type { StepId } from './types';

/**
 * The steps a mode will run, declared where the CLIENT can read them.
 *
 * AgentTrace could not answer "how much longer" because it had no denominator:
 * it derives its stepper from the events that have already arrived, so a step
 * does not exist to the UI until it starts. The real plan lives inside
 * runModeA/runModeB, which pull groq-sdk and the x402 settle path and so can
 * never be imported into a client component.
 *
 * Hence this: a plain, dependency-free mirror. `stepPlan.test.ts` drives the
 * REAL runners with mocked steps and asserts the call order matches these
 * arrays exactly, so adding or reordering a step in a runner fails the suite
 * rather than quietly making the progress counter lie.
 *
 * Note every step but groq is soft-fail: a plan is what will be ATTEMPTED, and
 * a failed step resolves its cell rather than removing it from the count.
 */
export const MODE_A_STEPS: readonly StepId[] = ['serper', 'groq'];
export const MODE_B_STEPS: readonly StepId[] = ['serper', 'coingecko', 'groq', 'factCheck'];

/**
 * Educational (on-chain mode id 0) runs runModeA; every other mode runs
 * runModeB. The literal 0 is pinned by stepPlan.test.ts against
 * educationalMode.id — the ids are append-only and never renumbered, so this
 * cannot drift silently.
 */
export function stepPlanFor(mode: number | null | undefined): readonly StepId[] {
  return mode === 0 ? MODE_A_STEPS : MODE_B_STEPS;
}
