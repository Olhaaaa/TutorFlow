/**
 * Ключ операції в журналі транзакцій — захист від подвійного застосування
 * того самого руху коштів.
 *
 * Доставка між сервісами at-least-once: завдання живе, доки отримувач не
 * підтвердив, тому те саме списання приходить двічі щоразу, коли підтвердження
 * не дійшло. Застосувати його двічі не можна — це гроші.
 *
 * Чому ключем не може бути слот. Студент бронює й скасовує ту саму годину по
 * колу: друге повернення за той самий слот — законна операція, а не повтор.
 * Тому ключ видає сторона, яка ініціює рух, рівно один раз на операцію, і
 * саме він стоїть у `unique`.
 *
 * Перевірка живе в БАЗІ, а не в коді, з тієї самої причини, що й
 * `notifications.dedup_key`: двом паралельним спробам перевірка в коді не
 * допомогла б — обидві пройшли б її до першої вставки.
 *
 * Індекс частковий, бо в моноліті ключа немає взагалі: там рух коштів
 * відбувається в одній транзакції зі зміною слота, і повторитись не може.
 */
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table transactions add column op_id text`.execute(db);
  await sql`
    create unique index transactions_op_id_key on transactions (op_id)
      where op_id is not null`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index if exists transactions_op_id_key`.execute(db);
  await sql`alter table transactions drop column if exists op_id`.execute(db);
}
