import { useMemo, useState } from 'react';
import { Globe, Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Session } from '@/api/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { zoneOffset } from '@/features/calendar/time';

/**
 * Перелік зон береться у браузера, а не зашивається в код: база IANA
 * оновлюється разом із правилами переходу на літній час, і власний список
 * застарів би мовчки.
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

/**
 * Назви регіонів українською. Самі зони лишаються в канонічному вигляді
 * `Europe/Kyiv` — це технічний ідентифікатор, який іде на сервер, і
 * перекладати його означало б завести другий словник назв зон.
 */
const REGIONS: Record<string, string> = {
  Europe: 'Європа',
  America: 'Америка',
  Asia: 'Азія',
  Africa: 'Африка',
  Australia: 'Австралія',
  Atlantic: 'Атлантика',
  Indian: 'Індійський океан',
  Pacific: 'Тихий океан',
  Antarctica: 'Антарктида',
  Arctic: 'Арктика',
  Etc: 'Зсуви від UTC',
};

interface ZoneGroup {
  region: string;
  label: string;
  zones: { value: string; city: string }[];
}

/**
 * Зони, згруповані за регіоном. Без груп список на чотири сотні рядків
 * нечитабельний, а з ними в ньому видно структуру: спершу Європа, бо тут
 * живе більшість користувачів, далі решта за алфавітом.
 *
 * Поточна зона додається, навіть якщо браузер її не перелічив: інакше,
 * відкривши список, користувач не побачив би в ньому того, що в нього зараз.
 */
function groupZones(zones: readonly string[], current: string): ZoneGroup[] {
  const byRegion = new Map<string, { value: string; city: string }[]>();

  for (const value of zones.includes(current) ? zones : [current, ...zones]) {
    const slash = value.indexOf('/');
    const region = slash < 0 ? 'Etc' : value.slice(0, slash);
    // «America/Argentina/Buenos_Aires» → «Argentina · Buenos Aires»
    const city = (slash < 0 ? value : value.slice(slash + 1))
      .replaceAll('_', ' ')
      .replaceAll('/', ' · ');

    const list = byRegion.get(region);
    if (list) list.push({ value, city });
    else byRegion.set(region, [{ value, city }]);
  }

  return [...byRegion]
    .map(([region, list]) => ({
      region,
      label: REGIONS[region] ?? region,
      zones: list.sort((a, b) => a.city.localeCompare(b.city, 'uk')),
    }))
    .sort((a, b) => {
      if (a.region === 'Europe') return -1;
      if (b.region === 'Europe') return 1;
      return a.label.localeCompare(b.label, 'uk');
    });
}

export function TimezoneCard({
  session,
  onChange,
}: {
  session: Session;
  onChange: (timezone: string) => void;
}) {
  const groups = useMemo(() => groupZones(allZones(), session.timezone), [session.timezone]);
  const browserZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  // Ліниве обчислення: рік потрібен лише раз, а виклик Date просто в рендері
  // зробив би компонент нечистим.
  const [year] = useState(() => new Date().getUTCFullYear());
  const [busy, setBusy] = useState(false);

  const teacher = session.role === 'teacher';

  const save = async (tz: string) => {
    if (tz === session.timezone) return;
    setBusy(true);
    try {
      const updated = await api.updateTimezone(session.token, tz);
      onChange(updated.timezone);
      toast.success(`Часовий пояс: ${updated.timezone}`, {
        description: 'Розклад перемальовано у новому часі',
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
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
          <Label htmlFor="tz-select">Нова зона</Label>
          {/*
            Вибір застосовується одразу, без окремої кнопки «Зберегти»: у
            випадному списку сам клік по пункту вже є підтвердженням, а зміна
            зони нічого не руйнує — заняття не рухаються, змінюється лише час,
            у якому вони показані.
          */}
          <Select value={session.timezone} disabled={busy} onValueChange={(z) => void save(z)}>
            <SelectTrigger id="tz-select" size="sm" className="w-full font-mono">
              {/*
                У тригері стоїть повна назва зони, а не підпис вибраного
                пункту: «Kyiv» без регіону ні про що не каже, а саме цей рядок
                іде на сервер. Явні children ще й гасять підстановку тексту
                пункту, яку Radix робить за замовчуванням.
              */}
              <SelectValue>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {session.timezone}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {groups.map((g) => (
                <SelectGroup key={g.region}>
                  <SelectLabel>{g.label}</SelectLabel>
                  {g.zones.map((z) => (
                    <SelectItem key={z.value} value={z.value}>
                      <span className="flex w-full items-baseline justify-between gap-3">
                        <span>{z.city}</span>
                        {/*
                          Зсув рахується тут, а не наперед для всього списку:
                          Intl.DateTimeFormat на кожну з чотирьох сотень зон —
                          помітна пауза, а Radix малює пункти лише коли список
                          уже відкрито.
                        */}
                        <span className="font-mono text-xs text-muted-foreground tabular-nums">
                          {zoneOffset(z.value)}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!behavesSame(browserZone, session.timezone, year) && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={busy}
            onClick={() => void save(browserZone)}
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
