import { useMemo, useState } from 'react';
import { Globe, Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Session } from '@/api/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { zoneOffset } from '@/features/calendar/time';

/**
 * Перелік зон береться у браузера, а не зашивається в код: база IANA
 * оновлюється разом із правилами переходу на літній час, і власний список
 * застарів би мовчки. Старі браузери без цього API просто отримають поле без
 * підказок — ввести назву руками все одно можна.
 */
function allZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
}

/**
 * Чи означають дві назви одне й те саме на практиці.
 *
 * Потрібне через аліаси: браузер може звати зону `Europe/Kiev`, а в базі
 * лежить канонічне `Europe/Kyiv` — обидві назви валідні, і пропонувати
 * «змінити» одну на іншу безглуздо. Порівнюємо не рядки, а поведінку: якщо
 * взимку й улітку обидві дають той самий місцевий час, різниці для розкладу
 * немає.
 */
function behavesSame(a: string, b: string, year: number): boolean {
  if (a === b) return true;
  try {
    const stamp = (tz: string, month: number) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        dateStyle: 'short',
        timeStyle: 'long',
      }).format(new Date(Date.UTC(year, month, 15, 12)));
    return stamp(a, 0) === stamp(b, 0) && stamp(a, 6) === stamp(b, 6);
  } catch {
    return false;
  }
}

export function TimezoneCard({
  session,
  onChange,
}: {
  session: Session;
  onChange: (timezone: string) => void;
}) {
  const zones = useMemo(() => allZones(), []);
  const browserZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  // Ліниве обчислення: рік потрібен лише раз, а виклик Date просто в рендері
  // зробив би компонент нечистим.
  const [year] = useState(() => new Date().getUTCFullYear());
  const [value, setValue] = useState(session.timezone);
  const [busy, setBusy] = useState(false);

  const changed = value.trim() !== '' && value !== session.timezone;
  const teacher = session.role === 'teacher';

  const save = async (tz: string) => {
    setBusy(true);
    try {
      const updated = await api.updateTimezone(session.token, tz);
      onChange(updated.timezone);
      setValue(updated.timezone);
      toast.success(`Часовий пояс: ${updated.timezone}`, {
        description: 'Розклад перемальовано у новому часі',
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setValue(session.timezone);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-3">
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <Globe className="size-4" aria-hidden />
          Часовий пояс
        </CardTitle>
        <CardDescription>
          Зараз: <span className="font-mono">{session.timezone}</span> ({zoneOffset(session.timezone)}).
          Увесь розклад показується саме в ньому.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="tz-input">Нова зона</Label>
          <div className="flex gap-1">
            <Input
              id="tz-input"
              list="tz-options"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Europe/Kyiv"
              className="h-8 font-mono"
            />
            <Button size="sm" disabled={busy || !changed} onClick={() => save(value.trim())}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : 'Зберегти'}
            </Button>
          </div>
          <datalist id="tz-options">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </div>

        {!behavesSame(browserZone, session.timezone, year) && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={busy}
            onClick={() => save(browserZone)}
          >
            Взяти з браузера: {browserZone}
          </Button>
        )}

        {teacher && (
          <Alert>
            <Info aria-hidden />
            <AlertDescription>
              Уже створені заняття не рухаються — вони просто показуються в новому часі. А ось
              тижневий шаблон задано вашим настінним часом, тому слоти, згенеровані після зміни
              зони, стануть на нову годину. Після переїзду шаблон варто переглянути.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
