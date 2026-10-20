import { useState } from 'react';
import { CircleAlert, Loader2, LogIn, MailCheck } from 'lucide-react';
import { ApiError, api, type Session } from '@/api/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Демонстраційний акаунт із сідера — щоб перевіряючому не доводилось шукати логін. */
const DEMO = { email: 'anya@tutorflow.local', password: 'tutorflow' };

export function Login({
  onReady, onRegister,
}: { onReady: (s: Session) => void; onRegister: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* Підказка після невдалого входу з непідтвердженою поштою й після запиту
     на відновлення. Обидва випадки закінчуються одним: «перевірте скриньку». */
  const [notice, setNotice] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onReady(await api.login(email.trim(), password));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'не вдалось увійти');
      // 403 тут означає рівно одне: пароль правильний, пошта не підтверджена.
      setUnverified(err instanceof ApiError && err.status === 403);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Tutorflow</CardTitle>
          <CardDescription>Розклад і баланс занять із репетитором.</CardDescription>
        </CardHeader>

        <form onSubmit={submit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Пошта</Label>
              <Input
                id="email"
                type="email"
                value={email}
                autoComplete="username"
                placeholder="ви@пошта.ua"
                required
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                value={password}
                autoComplete="current-password"
                required
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <CircleAlert aria-hidden />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {notice && (
              <Alert>
                <MailCheck aria-hidden />
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            )}

            {unverified && (
              <Button
                type="button" variant="outline" size="sm" className="w-full"
                onClick={async () => {
                  await api.resendVerification(email.trim()).catch(() => undefined);
                  setUnverified(false);
                  setError(null);
                  setNotice('Лист із посиланням надіслано ще раз — перевірте скриньку.');
                }}
              >
                надіслати лист підтвердження ще раз
              </Button>
            )}
          </CardContent>

          <CardFooter className="mt-6 flex-col gap-2">
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <LogIn aria-hidden />}
              {busy ? 'вхід…' : 'Увійти'}
            </Button>
            <div className="flex w-full gap-2">
              <Button
                type="button" variant="outline" size="sm" className="flex-1"
                onClick={onRegister}
              >
                зареєструватись
              </Button>
              <Button
                type="button" variant="outline" size="sm" className="flex-1"
                disabled={email.trim() === ''}
                onClick={async () => {
                  await api.forgotPassword(email.trim()).catch(() => undefined);
                  setError(null);
                  setUnverified(false);
                  setNotice('Якщо така адреса є, лист із посиланням уже в дорозі.');
                }}
              >
                забули пароль?
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                setEmail(DEMO.email);
                setPassword(DEMO.password);
              }}
            >
              заповнити демо-акаунт
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
