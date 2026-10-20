/**
 * Правила входу, які не залежать ні від бази, ні від HTTP: вимоги до пароля,
 * строк життя одноразових кодів і обмеження частоти.
 *
 * Вони тут, а не в сервісі, з тієї самої причини, що й решта ядра: правило,
 * записане чистою функцією, перевіряється тестом за мілісекунди й однакове в
 * моноліті та в сервісі входу. Сервіс лишає собі те, що ядро робити не може, —
 * читання, запис і надсилання листа.
 */

/** Призначення одноразового коду. Строк життя в них різний — див. нижче. */
export type TokenPurpose = 'verify_email' | 'reset_password';

/**
 * Мінімальна довжина пароля.
 *
 * Дванадцять, а не вісім: вісім символів сьогодні перебираються за години
 * навіть із bcrypt, якщо хеші витекли. Вимог до «спецсимволів» навмисно
 * немає — вони женуть людей до `Password1!`, який слабший за довгу фразу.
 */
export const PASSWORD_MIN_LENGTH = 12;

/** Довший за це пароль відхиляється: bcrypt однаково читає перші 72 байти. */
export const PASSWORD_MAX_LENGTH = 72;

export type PasswordIssue =
  | 'too_short'
  | 'too_long'
  | 'whitespace_only'
  | 'looks_like_email'
  | 'repeats_one_character';

/**
 * Чому пароль не годиться. Порожній масив означає «годиться».
 *
 * Перевірки навмисно про ФОРМУ, а не про «складність»: оцінка складності
 * без словника дає хибну впевненість, а зі словником — це вже окрема
 * залежність і окреме рішення.
 */
export function passwordIssues(password: string): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  const bytes = utf8Length(password);

  if (password.trim().length === 0) {
    issues.push('whitespace_only');
    return issues;
  }
  if (password.length < PASSWORD_MIN_LENGTH) issues.push('too_short');
  if (bytes > PASSWORD_MAX_LENGTH) issues.push('too_long');
  if (/^\S+@\S+\.\S+$/.test(password.trim())) issues.push('looks_like_email');
  if (new Set(password).size === 1) issues.push('repeats_one_character');

  return issues;
}

/**
 * Довжина рядка в БАЙТАХ UTF-8, порахована без `Buffer` і `TextEncoder`.
 *
 * Ядро не залежить ні від Node, ні від браузера — у цьому його сенс: ті самі
 * правила виконуються і в застосунку, і в тестах, і потенційно в клієнті.
 * Рахувати доводиться саме байти, бо обмеження йде від bcrypt: він читає
 * перші 72 БАЙТИ, і кирилична фраза вичерпує їх удвічі швидше за латинську.
 */
function utf8Length(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * Строк життя коду.
 *
 * Підтвердження пошти — доба: лист може полежати в скриньці до вечора, і
 * змушувати людину повторювати реєстрацію через годину безглуздо.
 *
 * Відновлення пароля — година: цей код відкриває доступ до акаунта, тому
 * вікно, у яке він працює з чужої скриньки чи з лога поштового шлюзу, має
 * бути коротким.
 */
export const TOKEN_TTL_MINUTES: Record<TokenPurpose, number> = {
  verify_email: 24 * 60,
  reset_password: 60,
};

export function tokenExpiry(purpose: TokenPurpose, now: Date): Date {
  return new Date(now.getTime() + TOKEN_TTL_MINUTES[purpose] * 60_000);
}

export function isTokenUsable(
  token: { expiresAt: Date; usedAt: Date | null },
  now: Date,
): boolean {
  return token.usedAt === null && token.expiresAt > now;
}

/** Скільки спроб і за яке вікно дозволено для кожної дії. */
export interface ThrottlePolicy {
  attempts: number;
  windowMinutes: number;
}

/**
 * Ліміти навмисно різні.
 *
 * Реєстрація й надсилання листів обмежені жорстко: кожна спроба — це лист
 * комусь на пошту, тобто безкоштовний спосіб завалити чужу скриньку чужими
 * руками. Вхід обмежений мʼякше, бо помилитись паролем — нормально, і
 * занадто суворий ліміт перетворюється на відмову в обслуговуванні для
 * власника акаунта.
 */
export const THROTTLE: Record<'register' | 'send_email' | 'login', ThrottlePolicy> = {
  register: { attempts: 3, windowMinutes: 60 },
  send_email: { attempts: 3, windowMinutes: 60 },
  login: { attempts: 10, windowMinutes: 15 },
};

export interface ThrottleState {
  attempts: number;
  windowStarts: Date;
}

export interface ThrottleDecision {
  allowed: boolean;
  /** Коли вікно обнуляється. Віддається клієнту як Retry-After. */
  retryAfterSeconds: number;
  /** Стан, який треба записати назад. */
  next: ThrottleState;
}

/**
 * Чи дозволена ще одна спроба.
 *
 * Вікно фіксоване, а не ковзне: ковзне потребує журналу всіх спроб, а
 * фіксованого достатньо проти того, від чого ми захищаємось — автоматичного
 * перебору й розсилання листів. Поведінка на межі свідома: коли вікно
 * минуло, лічильник починається заново з цієї спроби.
 */
export function throttleDecision(
  state: ThrottleState | null,
  policy: ThrottlePolicy,
  now: Date,
): ThrottleDecision {
  const windowMs = policy.windowMinutes * 60_000;
  const fresh = state === null || now.getTime() - state.windowStarts.getTime() >= windowMs;

  if (fresh) {
    return { allowed: true, retryAfterSeconds: 0, next: { attempts: 1, windowStarts: now } };
  }

  const attempts = state.attempts + 1;
  const endsAt = state.windowStarts.getTime() + windowMs;
  const allowed = attempts <= policy.attempts;

  return {
    allowed,
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((endsAt - now.getTime()) / 1000)),
    next: { attempts, windowStarts: state.windowStarts },
  };
}

/**
 * Пошта в канонічному вигляді: нижній регістр і без крайніх пробілів.
 *
 * Робиться в ОДНОМУ місці й застосовується скрізь — на реєстрації, на вході
 * й на відновленні. Інакше `Ivan@Mail.ua` і `ivan@mail.ua` стають двома
 * акаунтами, а унікальний індекс у базі цього не ловить.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
