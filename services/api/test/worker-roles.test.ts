/**
 * Роли воркера. Чисте правило: від нього залежить, що саме робить процес, і
 * описка в оточенні не повинна давати процес, який тихо не робить нічого.
 */
import { describe, expect, it } from 'vitest';
import {
  UnknownWorkerRoleError, WORKER_ROLES, parseWorkerRoles,
} from '../src/worker-roles.js';

describe('розбір WORKER_ROLES', () => {
  it('порожнє значення — усі роли: так воркер працює в лабі 2', () => {
    expect(parseWorkerRoles(null)).toEqual([...WORKER_ROLES]);
    expect(parseWorkerRoles(undefined)).toEqual([...WORKER_ROLES]);
    expect(parseWorkerRoles('')).toEqual([...WORKER_ROLES]);
    expect(parseWorkerRoles('   ')).toEqual([...WORKER_ROLES]);
    expect(parseWorkerRoles(',,')).toEqual([...WORKER_ROLES]);
  });

  it('одна роль — процес робить одне', () => {
    expect(parseWorkerRoles('events')).toEqual(['events']);
    expect(parseWorkerRoles('bot')).toEqual(['bot']);
    expect(parseWorkerRoles('transitions')).toEqual(['transitions']);
  });

  it('кілька ролей, регістр і пробіли не мають значення', () => {
    expect(parseWorkerRoles(' Events , BOT ')).toEqual(['events', 'bot']);
  });

  it('порядок у значенні не впливає на результат', () => {
    expect(parseWorkerRoles('bot,events')).toEqual(parseWorkerRoles('events,bot'));
  });

  it('повтор нічого не додає', () => {
    expect(parseWorkerRoles('events,events')).toEqual(['events']);
  });

  it('невідома роль — помилка, а не тиха байдужість', () => {
    expect(() => parseWorkerRoles('evnets')).toThrow(UnknownWorkerRoleError);
    expect(() => parseWorkerRoles('events,pdf')).toThrow(/невідома роль/);
  });
});
