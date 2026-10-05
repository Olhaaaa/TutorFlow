import { Injectable } from '@nestjs/common';
import { chargeAmount, isAffordable, minor, refundAmount } from '@tutorflow/core';
import type { ChargePort } from '../scheduling/ports.js';
import type { Executor } from '../scheduling/slots.repository.js';
import { StudentsRepository } from './students.repository.js';
import { TransactionsRepository } from './transactions.repository.js';

/**
 * Реалізація межі, яку оголосив модуль розкладу.
 *
 * Кожен метод приймає транзакцію й виконується всередині неї — гроші рухаються
 * в тій самій транзакції, що й зміна слота. Якщо впаде будь-яка половина,
 * відкотиться вся операція, і стану «слот заброньований, кошти не списані» не
 * виникне.
 *
 * Запис у журнал і зсув кешованого балансу йдуть разом: журнал — джерело
 * істини, баланс у `students` — лише кеш для швидкого читання.
 */
@Injectable()
export class ChargeAdapter implements ChargePort {
  constructor(
    private readonly students: StudentsRepository,
    private readonly transactions: TransactionsRepository,
  ) {}

  async balanceOf(tx: Executor, studentId: number): Promise<number> {
    const student = await this.students.byId(studentId, tx);
    return student?.balance_minor ?? 0;
  }

  async isAffordable(tx: Executor, studentId: number, priceMinor: number): Promise<boolean> {
    const balance = await this.balanceOf(tx, studentId);
    return isAffordable(minor(balance), minor(priceMinor));
  }

  async chargeForLesson(
    tx: Executor, studentId: number, slotId: number, priceMinor: number,
  ): Promise<void> {
    const amount = chargeAmount(minor(priceMinor));
    await this.transactions.add(
      { studentId, amountMinor: amount, kind: 'lesson_charge', slotId }, tx,
    );
    await this.students.shiftBalance(studentId, amount, tx);
  }

  async refundForLesson(
    tx: Executor, studentId: number, slotId: number, priceMinor: number,
  ): Promise<void> {
    const amount = refundAmount(minor(priceMinor));
    await this.transactions.add(
      { studentId, amountMinor: amount, kind: 'refund', slotId }, tx,
    );
    await this.students.shiftBalance(studentId, amount, tx);
  }
}
