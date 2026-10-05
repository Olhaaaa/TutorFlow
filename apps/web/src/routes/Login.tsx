import { useState } from 'react';
import { CircleAlert, Loader2, LogIn } from 'lucide-react';
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

export function Login({ onReady }: { onReady: (s: Session) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onReady(await api.login(email.trim(), password));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'не вдалось увійти');
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
          </CardContent>

          <CardFooter className="mt-6 flex-col gap-2">
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <LogIn aria-hidden />}
              {busy ? 'вхід…' : 'Увійти'}
            </Button>
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
