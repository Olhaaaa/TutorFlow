import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export type Role = 'student' | 'teacher';

/** Те, що лежить у токені. Нічого зайвого: лише те, чим авторизуються запроси. */
export interface TokenPayload {
  sub: number;
  role: Role;
  /** Для студента — його викладач; для викладача — він сам. */
  teacherId: number;
}

/**
 * Випуск і перевірка токена — і НІЧОГО більше.
 *
 * Відділено від входу навмисно, і причина стане видною в лабораторній 3.
 * Перевірити токен означає звірити підпис: для цього потрібен лише секрет,
 * жодної бази. Виписати токен означає спершу знайти людину й звірити пароль:
 * для цього потрібна база з реквізитами.
 *
 * Доки обидві операції жили в одному сервісі, різниці не було. Коли вхід став
 * окремим сервісом, вона стала головною: токен перевіряє КОЖЕН сервіс у себе,
 * нікого не питаючи, а виписує його рівно один. Інакше кожен запрос до
 * розкладу тягнув би звернення до входу — і той став би єдиною точкою відмови
 * для всієї системи.
 */
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(payload: TokenPayload): string {
    return this.jwt.sign(payload);
  }

  /** @returns payload або null, якщо підпис не сходиться чи токен прострочений. */
  verify(token: string): TokenPayload | null {
    try {
      return this.jwt.verify<TokenPayload>(token);
    } catch {
      return null;
    }
  }
}
