import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Session } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { messageOf } from '@/routes/Register';

/**
 * Зміна власного пароля.
 *
 * Поточний пароль запитується навіть тут, у кабінеті, куди людина вже
 * увійшла. Причина не формальна: токен живе тиждень і міг лишитись у чужих
 * руках — на спільному компʼютері, у збереженій сесії браузера. Без цього
 * поля той, хто дістав токен, забрав би акаунт назавжди за два кліки.
 *
 * Після успіху поля очищаються, а не лишаються заповненими: наступне, що
 * людина зробить на цьому екрані, — точно не зміна пароля ще раз.
 */
export function PasswordCard({ session }: { session: Session }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.changePassword(session.token, current, next);
      setCurrent('');
      setNext('');
      toast.success('Пароль змінено', {
        description: 'На вашу пошту пішло сповіщення про зміну',
      });
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-3">
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <KeyRound className="size-4" aria-hidden />
          Пароль
        </CardTitle>
        <CardDescription>
          Потрібен поточний пароль: токен міг лишитись у чужих руках, і без цього поля його
          вистачило б, щоб забрати акаунт.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form className="space-y-3" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="cur-password" className="text-xs">Поточний</Label>
            <Input
              id="cur-password" type="password" className="h-8" required
              autoComplete="current-password" value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="next-password" className="text-xs">Новий</Label>
            <Input
              id="next-password" type="password" className="h-8" required minLength={12}
              autoComplete="new-password" value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Щонайменше 12 символів.</p>
          </div>
          <Button type="submit" size="sm" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <KeyRound aria-hidden />}
            Змінити пароль
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
