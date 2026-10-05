import { useCallback, useEffect, useState } from 'react';
import { CalendarHeart, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Session } from '@/api/client';
import type { Enrollment, Student } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

const DOW = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота'];
const DOW_SHORT = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * Постійні місця студентів у розкладі.
 *
 * Це головна відмінність репетиторства від разових бронювань: студент ходить
 * щотижня в ту саму годину, і місце тримається за ним без щоразового
 * підтвердження. Закріплення одразу переводить майбутні вільні слоти цієї
 * години в «не оплачено» — далі їх закриває поповнення балансу.
 */
export function EnrollmentsCard({ session }: { session: Session }) {
  const [list, setList] = useState<Enrollment[] | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState<number | null>(null);
  const [weekday, setWeekday] = useState(1);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [e, s] = await Promise.all([
        api.teacher.enrollments(session.token),
        api.teacher.students(session.token),
      ]);
      setList(e);
      setStudents(s);
      setStudentId((prev) => prev ?? s[0]?.id ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setList([]);
    }
  }, [session.token]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (studentId === null) return;
    const startTime = String(new FormData(e.currentTarget).get('startTime') ?? '');
    setBusy(true);
    try {
      const r = await api.teacher.enroll(session.token, { studentId, weekday, startTime });
      toast.success('Місце закріплено', {
        description:
          r.slotsHeld > 0
            ? `Закріплено майбутніх занять: ${r.slotsHeld}`
            : 'Вільних слотів на цю годину поки немає — згенеруйте їх із шаблону',
      });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number, name: string) => {
    setBusy(true);
    try {
      const r = await api.teacher.unenroll(session.token, id);
      toast.success(`Закріплення знято: ${name}`, {
        description:
          r.slotsReleased > 0
            ? `Звільнено неоплачених занять: ${r.slotsReleased}`
            : 'Оплачені заняття лишились за студентом',
      });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarHeart className="size-5" aria-hidden />
          Постійні місця
        </CardTitle>
        <CardDescription>
          Студент ходить щотижня в ту саму годину. Закріплення одразу тримає майбутні заняття цієї
          години, а оплачує їх поповнення балансу — від найраніших.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {list === null ? (
          <Skeleton className="h-16 w-full" />
        ) : list.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            закріплень ще немає
          </p>
        ) : (
          <ul className="space-y-1.5">
            {list.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <Badge variant="outline" className="font-mono tabular-nums">
                  {DOW_SHORT[e.weekday]} {e.start_time.slice(0, 5)}
                </Badge>
                <span className="font-medium">{e.student_name}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto"
                  disabled={busy}
                  onClick={() => remove(e.id, e.student_name)}
                  aria-label={`Зняти закріплення ${e.student_name}`}
                  title="Зняти закріплення"
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form className="flex flex-wrap items-end gap-2 border-t pt-4" onSubmit={add}>
          <div className="min-w-40 flex-1 space-y-1.5">
            <Label htmlFor="en-student">Студент</Label>
            <select
              id="en-student"
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              value={studentId ?? ''}
              onChange={(e) => setStudentId(Number(e.target.value))}
            >
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>День</Label>
            <div className="flex flex-wrap gap-1">
              {ORDER.map((d) => (
                <Button
                  key={d}
                  type="button"
                  size="sm"
                  variant={weekday === d ? 'default' : 'outline'}
                  onClick={() => setWeekday(d)}
                  aria-label={DOW[d]}
                >
                  {DOW_SHORT[d]}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="en-time">Година</Label>
            <Input id="en-time" name="startTime" type="time" defaultValue="16:00" required />
          </div>

          <Button type="submit" disabled={busy || studentId === null}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
            Закріпити
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
