/**
 * Пʼять сервісів лабораторної 3 — і це ті самі пʼять, що були названі в плані
 * ще до першого рядка коду.
 *
 * Межі збігаються з межами модулів моноліту, а не з шарами: кожен сервіс веде
 * свій домен наскрізь — таблиці, правила, маршрути. Через це поділ і вийшов
 * механічним: модуль узяли, оточили композицією й дали власну базу.
 *
 * | сервіс        | свої дані                                         |
 * |---------------|---------------------------------------------------|
 * | identity      | реквізити входу обох ролей                        |
 * | scheduling    | teachers, availability_rules, enrollments, slots, external_busy |
 * | billing       | students, transactions, payments, еквайринг       |
 * | notifications | notifications + проєкція контактів студентів      |
 * | gateway        | нічого: лише маршрутизація й віддача SPA          |
 */
export const SERVICES = ['gateway', 'identity', 'scheduling', 'billing', 'notifications'] as const;

export type ServiceRole = (typeof SERVICES)[number];

export class UnknownServiceError extends Error {
  constructor(raw: string) {
    super(
      `невідомий сервіс «${raw}» — очікується один із: ${SERVICES.join(', ')}`,
    );
    this.name = 'UnknownServiceError';
  }
}

/**
 * Яку роль виконує цей процес.
 *
 * Береться з аргументу команди, а не з оточення: образ один на всі пʼять
 * сервісів, і команда в compose — єдине місце, де видно, ЩО саме запущено.
 * Описка мусить валити процес на старті, а не давати сервіс, який тихо не
 * відповідає на свої маршрути.
 */
export function parseServiceRole(raw: string | undefined): ServiceRole {
  const value = raw?.trim().toLowerCase();
  if (!value) throw new UnknownServiceError('(не задано)');
  if (!SERVICES.includes(value as ServiceRole)) throw new UnknownServiceError(value);
  return value as ServiceRole;
}
