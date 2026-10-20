import type { Role } from './token.service.js';

/** Запис, за яким перевіряється пароль. Хеш назовні з сервісу не виходить. */
export interface CredentialRecord {
  id: number;
  role: Role;
  email: string;
  passwordHash: string;
  name: string;
  timezone: string;
  teacherId: number;
  /**
   * Чи підтверджена пошта.
   *
   * Для студента завжди `true`, і це не недогляд: студента заводить
   * викладач, тобто адресу вже підтвердила людина, яка за нього відповідає.
   * Форма реєстрації існує лише для викладачів, тому й підтверджувати
   * пошту доводиться тільки їм.
   */
  emailVerified: boolean;
}

/** Профіль, потрібний листу: імʼя в звертанні й адреса. */
export interface IdentityRecord {
  id: number;
  role: Role;
  name: string;
  email: string;
  emailVerified: boolean;
}

/** Те, що потрібно, щоб завести викладача з форми реєстрації. */
export interface TeacherRegistration {
  name: string;
  email: string;
  passwordHash: string;
  timezone: string;
  defaultPriceMinor: number;
}

/**
 * МЕЖА ВХОДУ. Оголошена входом, реалізується тим, хто тримає реквізити.
 *
 * У моноліті реквізити лежать у двох таблицях — `teachers` і `students`, — і
 * вхід читав обидві сам. Це єдине місце застосунку, яке зазирало в дані ОБОХ
 * вертикалей, і саме тому поділ на сервіси неминуче зачіпає його першим.
 *
 * Порт лишає вхід без знання про те, звідки реквізити: у моноліті їх дають
 * репозиторії обох вертикалей, у лабораторній 3 — власна таблиця сервіса
 * входу, наповнена подією «зʼявився студент».
 */
export interface CredentialsPort {
  /**
   * Пошук за поштою серед УСІХ ролей.
   *
   * Повертається рівно один запис: пошта в системі унікальна в межах ролі, і
   * реалізація мусить сама вирішити порядок пошуку. Відповідь «не знайдено»
   * назовні не відрізняється від «пароль не той» — інакше форму входу можна
   * було б використати для перебору адрес.
   */
  byEmail(email: string): Promise<CredentialRecord | null>;

  /**
   * Змінити часовий пояс людини.
   *
   * Зона — не дані входу, а дані профілю, і живе вона там, де сама людина:
   * у `teachers` чи `students`. Вхід лише приймає запрос, бо саме він знає,
   * хто його зробив. У лабораторній 3 реалізація мусить ще й рознести зміну
   * сусідам: від зони залежить і генерація слотів, і текст нагадування.
   */
  updateTimezone(
    id: number,
    role: Role,
    timezone: string,
  ): Promise<{ id: number; name: string; timezone: string } | null>;

  /**
   * Завести викладача з непідтвердженою поштою.
   *
   * @returns `null`, якщо адреса вже зайнята. Саме `null`, а не виняток:
   *          зайнята пошта — очікуваний результат форми реєстрації, а не
   *          поломка. Відповідь користувачеві при цьому однакова в обох
   *          випадках — див. AuthService.register.
   */
  createTeacher(registration: TeacherRegistration): Promise<IdentityRecord | null>;

  /** Профіль за номером і роллю — для листів і перевірок. */
  identityById(id: number, role: Role): Promise<IdentityRecord | null>;

  /**
   * Позначити пошту підтвердженою.
   *
   * @returns `false`, якщо вона вже була підтверджена раніше: повторне
   *          відкриття листа не має рухати момент підтвердження вперед.
   */
  markEmailVerified(id: number, at: Date): Promise<boolean>;

  /** Записати новий хеш пароля разом із моментом зміни. */
  setPassword(id: number, role: Role, passwordHash: string, at: Date): Promise<void>;
}

export const CREDENTIALS_PORT = 'CREDENTIALS_PORT';
