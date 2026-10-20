import { Inject, Injectable } from '@nestjs/common';
import { KYSELY, type Database } from '../db/database.module.js';
import type { Executor } from '../db/database.module.js';

/** Таблиця `students` належить модулю білінгу: на ній тримається баланс. */
@Injectable()
export class StudentsRepository {
  constructor(@Inject(KYSELY) private readonly root: Database) {}

  private db(tx?: Executor): Executor { return tx ?? this.root; }

  async byId(id: number, tx?: Executor) {
    return (
      (await this.db(tx)
        .selectFrom('students')
        .select(['id', 'teacher_id', 'name', 'email', 'balance_minor', 'timezone'])
        .where('id', '=', id)
        .executeTakeFirst()) ?? null
    );
  }

  /** Для входу: разом із хешем пароля, тому назовні не віддається. */
  async updateTimezone(id: number, timezone: string, tx?: Executor) {
    const row = await this.db(tx)
      .updateTable('students')
      .set({ timezone })
      .where('id', '=', id)
      .returning(['id', 'name', 'timezone'])
      .executeTakeFirst();

    return row ?? null;
  }

  async byEmailWithSecret(email: string, tx?: Executor) {
    return (
      (await this.db(tx)
        .selectFrom('students')
        .select(['id', 'teacher_id', 'name', 'email', 'password_hash', 'timezone'])
        .where('email', '=', email)
        .executeTakeFirst()) ?? null
    );
  }

  /**
   * Імена за ідентифікаторами — для розкладу викладача й для стрічки `.ics`.
   *
   * Пакетом, а не по одному: екран тижня містить до пʼятдесяти занять, і
   * запрос на кожне перетворив би один `join` на пʼятдесят звернень. У
   * мікросервісах той самий метод стає ОДНИМ запросом по HTTP, тому межа
   * лишається дешевою.
   */
  namesByIds(ids: readonly number[], tx?: Executor) {
    return this.db(tx)
      .selectFrom('students')
      .select(['id', 'name'])
      .where('id', 'in', [...ids])
      .execute();
  }

  async listByTeacher(teacherId: number, tx?: Executor) {
    return this.db(tx)
      .selectFrom('students')
      .select(['id', 'name', 'email', 'balance_minor', 'timezone'])
      .where('teacher_id', '=', teacherId)
      .orderBy('name')
      .execute();
  }

  async create(
    teacherId: number,
    s: { name: string; email: string; passwordHash: string; timezone: string },
    tx?: Executor,
  ) {
    return this.db(tx)
      .insertInto('students')
      .values({
        teacher_id: teacherId,
        name: s.name,
        email: s.email,
        password_hash: s.passwordHash,
        timezone: s.timezone,
      })
      .returning(['id', 'name', 'email', 'balance_minor', 'timezone'])
      .executeTakeFirstOrThrow();
  }

  /**
   * Зсунути кешований баланс на дельту й повернути нове значення.
   *
   * ПРАВИЛО: викликати лише разом із записом у журнал транзакцій і в тій самій
   * транзакції БД. Журнал — джерело істини, це поле лише кеш; зсув без запису
   * розсинхронізує їх, і звірка `audit` це покаже.
   *
   * Саме UPDATE з арифметикою в SQL, а не читання з наступним записом:
   * інакше два одночасні поповнення затерли б одне одного. База рахує приріст
   * атомарно в межах рядка.
   */
  /* ---------- пароль ---------- */

  /** Профіль для листів. Студента не реєструють сам, але пароль він міняє. */
  async identityById(id: number, tx?: Executor) {
    const row = await this.db(tx)
      .selectFrom('students')
      .select(['id', 'name', 'email'])
      .where('id', '=', id)
      .executeTakeFirst();

    return row ?? null;
  }

  async setPassword(id: number, passwordHash: string, at: Date, tx?: Executor) {
    await this.db(tx)
      .updateTable('students')
      .set({ password_hash: passwordHash, password_changed_at: at })
      .where('id', '=', id)
      .execute();
  }

  /* ---------- канал нагадувань ---------- */

  /**
   * Код привʼязки, який можна показати студентові. Якщо коду ще немає —
   * створюється.
   *
   * `where telegram_link_code is null` усередині UPDATE, а не перевірка в
   * коді: два одночасні відкриття екрана інакше створили б два коди, і один
   * із них студент побачив би, а звʼязати ним чат не зміг.
   */
  async ensureLinkCode(studentId: number, code: string, tx?: Executor) {
    await this.db(tx)
      .updateTable('students')
      .set({ telegram_link_code: code })
      .where('id', '=', studentId)
      .where('telegram_link_code', 'is', null)
      .execute();

    return this.telegramState(studentId, tx);
  }

  /**
   * Стан каналу: чи привʼязаний чат і який код показувати.
   *
   * Імʼя й зона віддаються тим самим рядком, бо каналу потрібен ПОВНИЙ
   * контакт — привітатись у чаті він мусить людиною, а не номером. Другий
   * запрос по те саме був би зайвим і в моноліті, і в мікросервісах.
   */
  async telegramState(studentId: number, tx?: Executor) {
    const row = await this.db(tx)
      .selectFrom('students')
      .select(['id', 'name', 'timezone', 'telegram_chat_id', 'telegram_link_code'])
      .where('id', '=', studentId)
      .executeTakeFirst();

    return row ?? null;
  }

  /**
   * Привʼязати чат за кодом. Код згоряє: після привʼязки він більше не
   * підходить нікому, тому повторне надсилання того самого коду іншим чатом
   * нічого не перезапише.
   *
   * @returns студент, якщо код підійшов; null якщо такого коду немає.
   */
  async linkTelegram(code: string, chatId: number | string, tx?: Executor) {
    const row = await this.db(tx)
      .updateTable('students')
      .set({ telegram_chat_id: Number(chatId), telegram_link_code: null })
      .where('telegram_link_code', '=', code)
      // teacher_id тут не потрібен навмисно: у базі сервіса нагадувань цієї
      // колонки немає взагалі — вона належить білінгу.
      .returning(['id', 'name'])
      .executeTakeFirst();

    return row ?? null;
  }

  async unlinkTelegram(studentId: number, tx?: Executor) {
    await this.db(tx)
      .updateTable('students')
      .set({ telegram_chat_id: null, telegram_link_code: null })
      .where('id', '=', studentId)
      .execute();
  }

  /* ---------- секретна адреса календаря ---------- */

  /**
   * Токен стрічки студента. Створюється при першому зверненні й більше не
   * змінюється: адреса, яку студент уже вставив у свій календар, мусить
   * працювати й завтра.
   *
   * `where calendar_token is null` усередині UPDATE, а не перевірка в коді —
   * два одночасні відкриття кабінету інакше випустили б два токени, і той,
   * що студент встиг скопіювати, перестав би підходити.
   */
  async ensureCalendarToken(studentId: number, token: string, tx?: Executor) {
    await this.db(tx)
      .updateTable('students')
      .set({ calendar_token: token })
      .where('id', '=', studentId)
      .where('calendar_token', 'is', null)
      .execute();

    const row = await this.db(tx)
      .selectFrom('students')
      .select(['id', 'name', 'timezone', 'calendar_token'])
      .where('id', '=', studentId)
      .executeTakeFirst();

    return row ?? null;
  }

  /** Хто власник цієї стрічки. Єдиний спосіб автентифікації для .ics. */
  async byCalendarToken(token: string, tx?: Executor) {
    const row = await this.db(tx)
      .selectFrom('students')
      .select(['id', 'teacher_id', 'name', 'timezone'])
      .where('calendar_token', '=', token)
      .executeTakeFirst();

    return row ?? null;
  }

  /** Відкликати стрічку: стара адреса перестає працювати негайно. */
  async clearCalendarToken(studentId: number, tx?: Executor) {
    await this.db(tx)
      .updateTable('students')
      .set({ calendar_token: null })
      .where('id', '=', studentId)
      .execute();
  }

  async shiftBalance(studentId: number, deltaMinor: number, tx?: Executor) {
    const row = await this.db(tx)
      .updateTable('students')
      .set((eb) => ({ balance_minor: eb('balance_minor', '+', deltaMinor) }))
      .where('id', '=', studentId)
      .returning(['id', 'balance_minor'])
      .executeTakeFirst();

    return row ?? null;
  }
}
