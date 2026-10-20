import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, Loader2, LogIn } from 'lucide-react';
import { api } from '@/api/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { messageOf } from './Register';

/**
 * Два екрани, на які приводить посилання з листа: підтвердження пошти й
 * задання нового пароля.
 *
 * Вони в одному файлі, бо спільного в них більше, ніж відмінного: обидва
 * дістають код із хеша адреси, обидва закінчуються поверненням до входу й
 * обидва мусять однаково поводитись із простроченим кодом.
 *
 * Код ЗНИКАЄ з адреси одразу після зчитування. Інакше він лишається в
 * історії браузера, у закладці й у заголовку Referer, який піде на будь-який
 * сторонній ресурс, відкритий із цієї сторінки.
 */

/** Підтвердження пошти: працює саме, людині нічого натискати. */
export function VerifyEmail({ token, onDone }: { token: string; onDone: () => void }) {
  const [state, setState] = useState<'busy' | 'ok' | 'fail'>('busy');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api.verifyEmail(token)
      .then(() => { if (alive) setState('ok'); })
      .catch((e) => { if (alive) { setError(messageOf(e)); setState('fail'); } });
    return () => { alive = false; };
  }, [token]);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          {state === 'busy' && <Loader2 className="size-5 animate-spin" aria-hidden />}
          {state === 'ok' && <CircleCheck className="size-5" aria-hidden />}
          {state === 'fail' && <CircleAlert className="size-5" aria-hidden />}
          {state === 'busy' ? 'Перевіряємо…' : state === 'ok' ? 'Пошту підтверджено' : 'Не вийшло'}
        </CardTitle>
        <CardDescription>
          {state === 'ok' && 'Тепер можна увійти звичайним способом.'}
          {state === 'fail' && (error ?? 'Посилання недійсне або вже використане.')}
          {state === 'busy' && 'Це займе мить.'}
        </CardDescription>
      </CardHeader>
      <CardFooter className="flex-col gap-2">
        <Button className="w-full" onClick={onDone} disabled={state === 'busy'}>
          <LogIn aria-hidden />
          Перейти до входу
        </Button>
        {state === 'fail' && (
          <p className="text-xs text-muted-foreground">
            Якщо строк минув — зареєструйтесь ще раз або попросіть новий лист на екрані входу.
          </p>
        )}
      </CardFooter>
    </Card>
  );
}

/** Новий пароль за кодом із листа. */
export function ResetPassword({ token, onDone }: { token: string; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== repeat) {
      setError('паролі не збігаються');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <CircleCheck className="size-5" aria-hidden />
            Пароль змінено
          </CardTitle>
          <CardDescription>
            Ми надіслали сповіщення на вашу пошту. Якщо це робили не ви — відновіть пароль
            негайно й перевірте доступ до скриньки.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button className="w-full" onClick={onDone}>
            <LogIn aria-hidden />
            Увійти з новим паролем
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">Новий пароль</CardTitle>
        <CardDescription>Посилання одноразове й діє годину від моменту запиту.</CardDescription>
      </CardHeader>
      <form onSubmit={submit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-password">Пароль</Label>
            <Input
              id="new-password" type="password" value={password} required minLength={12}
              autoComplete="new-password" onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Щонайменше 12 символів.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="repeat-password">Ще раз</Label>
            <Input
              id="repeat-password" type="password" value={repeat} required
              autoComplete="new-password" onChange={(e) => setRepeat(e.target.value)}
            />
          </div>
          {error && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
        <CardFooter className="mt-6 flex-col gap-2">
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {busy ? 'зберігаємо…' : 'Зберегти пароль'}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="w-full" onClick={onDone}>
            повернутись до входу
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
