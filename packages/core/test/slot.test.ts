import { describe, it, expect } from 'vitest';
import {
  canTransition, assertTransition, IllegalTransitionError,
  isOccupying, SLOT_STATUSES,
} from '../src/slot.js';

describe('автомат станів слота', () => {
  it('має рівно пʼять статусів', () => {
    expect(SLOT_STATUSES).toEqual(['free', 'pre_booked', 'booked', 'done', 'cancelled_late']);
  });

  it('дозволяє сім переходів із плану', () => {
    expect(canTransition('free', 'pre_booked')).toBe(true);
    expect(canTransition('free', 'booked')).toBe(true);
    expect(canTransition('pre_booked', 'booked')).toBe(true);
    expect(canTransition('pre_booked', 'free')).toBe(true);
    expect(canTransition('booked', 'free')).toBe(true);
    expect(canTransition('booked', 'cancelled_late')).toBe(true);
    expect(canTransition('booked', 'done')).toBe(true);
  });

  it('забороняє переходи з кінцевих станів', () => {
    expect(canTransition('done', 'free')).toBe(false);
    expect(canTransition('cancelled_late', 'free')).toBe(false);
    expect(canTransition('done', 'booked')).toBe(false);
  });

  it('забороняє перестрибування pre_booked у done', () => {
    expect(canTransition('pre_booked', 'done')).toBe(false);
    expect(canTransition('free', 'done')).toBe(false);
    expect(canTransition('free', 'cancelled_late')).toBe(false);
  });

  it('assertTransition кидає з деталями', () => {
    expect(() => assertTransition('done', 'free', 'student')).toThrow(IllegalTransitionError);
    try {
      assertTransition('done', 'free', 'billing');
    } catch (e) {
      expect((e as IllegalTransitionError).from).toBe('done');
      expect((e as IllegalTransitionError).actor).toBe('billing');
      expect((e as Error).message).toContain('billing');
    }
  });

  it('час викладача займають pre_booked, booked і done', () => {
    expect(isOccupying('pre_booked')).toBe(true);
    expect(isOccupying('booked')).toBe(true);
    expect(isOccupying('done')).toBe(true);
    expect(isOccupying('free')).toBe(false);
    expect(isOccupying('cancelled_late')).toBe(false);
  });
});
