import { useCallback, useEffect, useState } from 'react';
import { CircleCheck, Loader2, ScaleIcon, UserPlus, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Session } from '@/api/client';
import type { Student } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { money } from '@/features/calendar/time';
import { cn } from '@/lib/utils';

/** Типові суми: одне, два й чотири заняття за базовою ціною. */
const PRESETS = [500, 1000, 2000];

export function StudentsPanel({ session }: { session: Session }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [openFor, setOpenFor] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStudents(await api.teacher.students(session.token));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [session.token]);

  useEffect(() => {
    void load();
  }, [load]);

  const topup = async (student: Student, hryvnia: number) => {
    if (!Number.isFinite(hryvnia) || hryvnia <= 0) {
      toast.error('сума має бути додатною');
      return;
    }
    setBusyId(student.id);
    try {
      // Гроші на межі HTTP завжди в копійках цілим числом: на клієнті зручні
      // гривні, але множення робиться рівно тут, в одному місці.
      const r = await api.teacher.topup(session.token, student.id, Math.round(hryvnia * 100));
      const n = r.convertedSlots.length;
      toast.success(`Баланс ${student.name}: ${money(r.balanceMinor)}`, {
        description: n > 0 ? `Оплачено найближчих занять: ${n}` : 'Неоплачених занять не було',
      });
      setOpenFor(null);
      setCustom('');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const audit = async (student: Student) => {
    setBusyId(student.id);
    try {
      const r = await api.teacher.audit(session.token, student.id);
      if (r.consistent) {
        toast.success(`${student.name}: баланс сходиться з журналом`, {
          description: `${money(r.cached)} у картці, стільки ж у сумі операцій`,
        });
      } else {
        toast.error(`${student.name}: баланс розійшовся з журналом`, {
          description: `у картці ${money(r.cached)}, у журналі ${money(r.fromJournal)}`,
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const addStudent = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setAdding(true);
    try {
      const created = await api.teacher.addStudent(session.token, {
        name: String(form.get('name') ?? ''),
        email: String(form.get('email') ?? ''),
        timezone: String(form.get('timezone') ?? session.timezone),
        password: String(form.get('password') ?? ''),
      });
      toast.success(`Студента додано: ${created.name}`);
      e.currentTarget.reset();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card>
        <CardHeader>
          <CardTitle>Студенти</CardTitle>
          <CardDescription>
            Баланс поповнює викладач. Кошти одразу закривають найближчі закріплені заняття —
            від найраніших, доки вистачає суми.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : students.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
              студентів ще немає
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>студент</TableHead>
                  <TableHead>зона</TableHead>
                  <TableHead className="text-right">баланс</TableHead>
                  <TableHead className="text-right">дія</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <span className="font-medium">{s.name}</span>
                      <span className="block text-xs text-muted-foreground">{s.email}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{s.timezone}</TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant="outline"
                        className={cn(
                          'font-mono tabular-nums',
                          // не text-slot-paid-fg: той колір призначений для
                          // тексту поверх соснової заливки й на білому зникає
                          s.balance_minor > 0 && 'border-primary/50 text-primary',
                        )}
                      >
                        {money(s.balance_minor)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant={openFor === s.id ? 'secondary' : 'default'}
                        disabled={busyId === s.id}
                        onClick={() => setOpenFor(openFor === s.id ? null : s.id)}
                      >
                        {busyId === s.id ? (
                          <Loader2 className="animate-spin" aria-hidden />
                        ) : (
                          <Wallet aria-hidden />
                        )}
                        поповнити
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-1"
                        disabled={busyId === s.id}
                        onClick={() => audit(s)}
                        title="Звірити баланс із журналом операцій"
                      >
                        <ScaleIcon aria-hidden />
                        звірка
                      </Button>

                      {openFor === s.id && (
                        <div className="mt-2 flex flex-wrap items-center justify-end gap-1 rounded-md border bg-muted/50 p-2">
                          {PRESETS.map((p) => (
                            <Button
                              key={p}
                              size="sm"
                              variant="outline"
                              disabled={busyId === s.id}
                              onClick={() => topup(s, p)}
                            >
                              {p} ₴
                            </Button>
                          ))}
                          <Input
                            value={custom}
                            onChange={(e) => setCustom(e.target.value)}
                            inputMode="numeric"
                            placeholder="своя сума"
                            className="h-8 w-28"
                            aria-label={`Сума поповнення для ${s.name}`}
                          />
                          <Button
                            size="sm"
                            disabled={busyId === s.id || custom.trim() === ''}
                            onClick={() => topup(s, Number(custom.replace(',', '.')))}
                          >
                            <CircleCheck aria-hidden />
                            зарахувати
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Новий студент</CardTitle>
          <CardDescription>
            Пароль тимчасовий — студент входить із ним і далі користується застосунком.
          </CardDescription>
          <CardAction>
            <UserPlus className="size-4 text-muted-foreground" aria-hidden />
          </CardAction>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={addStudent}>
            <div className="space-y-1.5">
              <Label htmlFor="st-name">Імʼя</Label>
              <Input id="st-name" name="name" required maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-email">Пошта</Label>
              <Input id="st-email" name="email" type="email" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-tz">Часовий пояс</Label>
              <Input id="st-tz" name="timezone" defaultValue={session.timezone} required />
              <p className="text-xs text-muted-foreground">
                назва з бази IANA, наприклад <code className="font-mono">America/New_York</code>
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="st-pass">Тимчасовий пароль</Label>
              <Input id="st-pass" name="password" type="text" minLength={6} required />
            </div>
            <Button type="submit" className="w-full" disabled={adding}>
              {adding ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
              Додати
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
