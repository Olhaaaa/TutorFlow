import { useState } from 'react';
import { CircleAlert, Loader2, MailCheck, UserPlus } from 'lucide-react';
import { ApiError, api } from '@/api/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Реєстрація викладача.
 *
 * Два моменти, які видно саме тут.
 *
 * **Зона береться з браузера.** Питати її формою безглуздо: браузер знає
 * відповідь точніше за людину, а розклад будується саме в зоні викладача.
 * Змінити її можна потім у кабінеті.
 *
 * **Після успіху форма зникає.** Лишається одне повідомлення: «перевірте
 * пошту». Воно однакове і для вільної адреси, і для зайнятої — сервер
 * навмисно не розрізняє їх у відповіді, щоб формою не можна було перевіряти,
 * хто в системі є.
 */
export function Register({ onBack }: { onBack: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Kyiv';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.register({ name: name.trim(), email: email.trim(), password, timezone });
      setSent(true);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <MailCheck className="size-5" aria-hidden />
            Перевірте пошту
          </CardTitle>
          <CardDescription>
            Якщо адреса вільна, на неї пішов лист із посиланням. Воно діє добу; доки пошта не
            підтверджена, увійти не вийде.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="outline" className="w-full" onClick={onBack}>
            Повернутись до входу
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">Реєстрація викладача</CardTitle>
        <CardDescription>
          Студентів заводите ви самі вже в кабінеті — їм реєструватись не треба.
        </CardDescription>
      </CardHeader>

      <form onSubmit={submit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reg-name">Імʼя</Label>
            <Input
              id="reg-name" value={name} autoComplete="name" required
              placeholder="Марія Коваль" onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="reg-email">Пошта</Label>
            <Input
              id="reg-email" type="email" value={email} autoComplete="email" required
              placeholder="ви@пошта.ua" onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="reg-password">Пароль</Label>
            <Input
              id="reg-password" type="password" value={password} autoComplete="new-password"
              required minLength={12} onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Щонайменше 12 символів. Довга фраза надійніша за короткий набір символів.
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            Часовий пояс візьмемо з браузера: <span className="font-mono">{timezone}</span>.
            Змінити можна в кабінеті.
          </p>

          {error && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>

        <CardFooter className="mt-6 flex-col gap-2">
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
            {busy ? 'надсилаємо…' : 'Зареєструватись'}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="w-full" onClick={onBack}>
            у мене вже є акаунт
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

/**
 * Текст помилки для людини.
 *
 * Сервер віддає причини машинними словами (`too_short`), і показувати їх як є
 * не можна: людина має прочитати, що саме виправити.
 */
export function messageOf(err: unknown): string {
  if (!(err instanceof ApiError)) return 'не вдалось — спробуйте ще раз';

  const issues = (err.payload as { issues?: string[] } | undefined)?.issues;
  if (issues?.length) {
    const text: Record<string, string> = {
      too_short: 'пароль закороткий — потрібно щонайменше 12 символів',
      too_long: 'пароль задовгий',
      whitespace_only: 'пароль не може складатися з самих пробілів',
      looks_like_email: 'пароль не може бути вашою поштою',
      repeats_one_character: 'пароль не може бути одним символом підряд',
    };
    return issues.map((i) => text[i] ?? i).join('; ');
  }

  const retry = (err.payload as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
  if (retry) return `забагато спроб — спробуйте за ${Math.ceil(retry / 60)} хв`;

  return err.message;
}
