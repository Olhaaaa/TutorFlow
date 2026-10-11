/**
 * Роли воркера.
 *
 * У лабораторній 2 один процес робить три різні роботи: застосовує переходи
 * станів за часом, споживає події зі стріму й слухає оновлення бота. Поки
 * процес один, це дешево — усі три мовчать, доки немає роботи.
 *
 * У лабораторній 4 їх доведеться розвести, і причини в кожної свої:
 *
 *   events       масштабується KEDA за довжиною стріму — реплік стільки,
 *                скільки подій; група споживачів для цього й існує
 *   bot          НЕ масштабується: Telegram розриває `getUpdates`, якщо його
 *                просять з двох процесів, тому репліка рівно одна
 *   transitions  не потребує процесу взагалі — це CronJob, тому
 *                MAINTENANCE_INTERVAL_SEC=0 означає «один прохід і вийти»
 *
 * Якщо не передбачити цього зараз, у лабораторній 4 доведеться переписувати
 * точку входу. Передбачити — означає рівно цей перелік і один прапорець в
 * оточенні: `WORKER_ROLES=events` підіймає процес, який робить одне.
 */
export const WORKER_ROLES = ['transitions', 'events', 'bot'] as const;

export type WorkerRole = (typeof WORKER_ROLES)[number];

export class UnknownWorkerRoleError extends Error {
  constructor(readonly role: string) {
    super(`невідома роль воркера «${role}»; доступні: ${WORKER_ROLES.join(', ')}`);
    this.name = 'UnknownWorkerRoleError';
  }
}

/**
 * Розібрати `WORKER_ROLES`.
 *
 * Порожнє значення означає «усі роли»: так воркер поводиться в лабораторній 2 і
 * в локальному запуску, і саме це поведінка за замовчуванням. Невідома роль —
 * помилка, а не тиха байдужість: процес, який через описку не робить нічого,
 * шукають годинами.
 */
export function parseWorkerRoles(raw: string | null | undefined): WorkerRole[] {
  const value = raw?.trim();
  if (!value) return [...WORKER_ROLES];

  const roles = value
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter((r) => r !== '');

  if (roles.length === 0) return [...WORKER_ROLES];

  const unknown = roles.find((r) => !WORKER_ROLES.includes(r as WorkerRole));
  if (unknown) throw new UnknownWorkerRoleError(unknown);

  // Порядок і повтори не мають значення: роль або є, або немає.
  return [...WORKER_ROLES].filter((r) => roles.includes(r));
}
