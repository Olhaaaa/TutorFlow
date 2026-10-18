import { Injectable } from '@nestjs/common';
import type { PaymentsExpiryPort } from '../maintenance/ports.js';
import { PaymentsRepository } from './payments.repository.js';

/** Протермінування рахунків у тому самому процесі: прямий запрос у свою базу. */
@Injectable()
export class PaymentsExpiryAdapter implements PaymentsExpiryPort {
  constructor(private readonly payments: PaymentsRepository) {}

  expirePending(validityMinutes: number): Promise<number> {
    return this.payments.expirePending(validityMinutes);
  }
}
