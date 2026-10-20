import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import type { TeacherProfile, CredentialUpsert, StudentContact } from '@tutorflow/contracts';
import { KYSELY, type Database } from '../db/database.module.js';

/**
 * ПРОЄКЦІЇ: рядки, які сервіс тримає у себе, хоч господар їх — сусід.
 *
 * Це ціна поділу, яку найлегше недооцінити. Таблиця `students` у моноліті
 * одна, і кожен бачив у ній усе, що йому потрібно: вхід — пошту й хеш
 * пароля, білінг — баланс, канал нагадувань — чат. Після поділу рядок
 * розʼїхався по трьох базах, і в кожній лишилось тільки своє.
 *
 * Два правила, якими це тримається.
 *
 * Перше: у кожної колонки ОДИН господар. Пошта й пароль — вхід, баланс і
 * строк оплати — білінг, привʼязка чату — нагадування. Проєкція ніколи не
 * пише в колонку, господар якої інший.
 *
 * Друге: проєкція наповнюється завданням з outbox, тобто з гарантією
 * доставки й ідемпотентно — `on conflict (id) do update`. Повторна доставка
 * того самого факту нічого не зіпсує, а пропущена не загубиться.
 */
@Injectable()
export class CredentialsProjection {
  private readonly log = new Logger('Credentials');

  constructor(@Inject(KYSELY) private readonly db: Database) {}

  /**
   * Прийняти реквізити входу.
   *
   * Студенти приходять завданням від білінгу — їх заводить викладач.
   * Викладачі приходять із сідера й із форми реєстрації, і для них запрос
   * пишеться СИРИМ SQL навмисно: у базі сервіса входу немає колонки
   * `default_price_minor` — її зрізано разом із рештою чужих, — а спільний
   * тип схеми вимагає її при вставці. Писати через типізований будівник
   * означало б або тримати в базі входу чужу колонку, або брехати типом.
   */
  async upsert(rec: CredentialUpsert): Promise<void> {
    if (rec.role === 'teacher') {
      await sql`
        insert into teachers (id, name, email, password_hash, timezone)
        values (${rec.id}, ${rec.name}, ${rec.email}, ${rec.passwordHash}, ${rec.timezone})
        on conflict (id) do update set
          name = excluded.name,
          email = excluded.email,
          password_hash = excluded.password_hash,
          timezone = excluded.timezone`.execute(this.db);
    } else {
      await this.db
        .insertInto('students')
        .values({
          id: rec.id,
          teacher_id: rec.teacherId,
          name: rec.name,
          email: rec.email,
          password_hash: rec.passwordHash,
          timezone: rec.timezone,
        })
        .onConflict((oc) => oc.column('id').doUpdateSet({
          name: rec.name,
          email: rec.email,
          password_hash: rec.passwordHash,
          timezone: rec.timezone,
        }))
        .execute();
    }

    this.log.log(`реквізити ${rec.role} ${rec.id} прийняті`);
  }

  /** Зона у власній копії. Господар зони — сервіс, де живе сама людина. */
  async setTimezone(
    role: 'teacher' | 'student',
    id: number,
    timezone: string,
  ): Promise<void> {
    if (role === 'teacher') {
      await this.db.updateTable('teachers').set({ timezone }).where('id', '=', id).execute();
    } else {
      await this.db.updateTable('students').set({ timezone }).where('id', '=', id).execute();
    }
  }
}

/**
 * Контакт студента у сервісі нагадувань.
 *
 * Від рядка `students` тут лишились імʼя, зона й привʼязка чату. Пошти,
 * пароля й балансу в цій базі немає взагалі — і це не оптимізація, а межа:
 * каналу нагадувань нічого з цього не потрібно, тому він того й не бачить.
 *
 * Привʼязка чату — колонки, господар яких САМ цей сервіс, тому проєкція їх не
 * торкається: інакше повторна доставка факту «зʼявився студент» відвʼязала б
 * уже привʼязаний чат.
 */
@Injectable()
export class ContactProjection {
  private readonly log = new Logger('Contacts');

  constructor(@Inject(KYSELY) private readonly db: Database) {}

  async upsert(contact: StudentContact): Promise<void> {
    await this.db
      .insertInto('students')
      .values({
        id: contact.studentId,
        teacher_id: 0,
        name: contact.name,
        email: `student-${contact.studentId}@projection.local`,
        password_hash: '',
        timezone: contact.timezone,
      })
      .onConflict((oc) => oc.column('id').doUpdateSet({
        name: contact.name,
        timezone: contact.timezone,
      }))
      .execute();

    this.log.log(`контакт студента ${contact.studentId} прийнятий`);
  }
}

/**
 * Копія профілю викладача в базі СУСІДА.
 *
 * Живе в розкладі й у білінгу, і колонки в них різні: розкладу потрібні зона
 * й ціна, білінгу — лише імʼя, бо все інше з профілю там зрізано. Тому запрос
 * і тут сирий: один типізований будівник на дві різні таблиці з однаковою
 * назвою не напишеш.
 *
 * Операція ідемпотентна: повторна доставка того самого завдання оновлює
 * рядок, а не падає на унікальному ключі.
 */
@Injectable()
export class TeacherProfileProjection {
  private readonly log = new Logger('TeacherProfile');

  constructor(@Inject(KYSELY) private readonly db: Database) {}

  /** Розклад: зона й типова ціна — те, з чого розгортаються слоти. */
  async upsertForScheduling(p: TeacherProfile): Promise<void> {
    await sql`
      insert into teachers (id, name, timezone, default_price_minor)
      values (${p.id}, ${p.name}, ${p.timezone}, ${p.defaultPriceMinor})
      on conflict (id) do update set
        name = excluded.name,
        timezone = excluded.timezone,
        default_price_minor = excluded.default_price_minor`.execute(this.db);

    this.log.log(`викладач ${p.id} прийнятий розкладом`);
  }

  /** Білінг: лише імʼя — решту профілю звідти зрізано. */
  async upsertForBilling(p: TeacherProfile): Promise<void> {
    await sql`
      insert into teachers (id, name)
      values (${p.id}, ${p.name})
      on conflict (id) do update set name = excluded.name`.execute(this.db);

    this.log.log(`викладач ${p.id} прийнятий білінгом`);
  }
}
