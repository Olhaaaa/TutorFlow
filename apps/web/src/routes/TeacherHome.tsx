import { useState } from 'react';
import { CalendarDays, Clock, CreditCard, Users } from 'lucide-react';
import type { Session } from '@/api/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AvailabilityPanel } from '@/features/teacher/AvailabilityPanel';
import { PaymentsPanel } from '@/features/teacher/PaymentsPanel';
import { StudentsPanel } from '@/features/teacher/StudentsPanel';
import { TeacherSchedule } from '@/features/teacher/TeacherSchedule';

/**
 * Кабінет викладача: три вкладки, по одній на задачу.
 *
 * Дані кожна вкладка вантажить собі сама. Для трьох екранів спільне сховище
 * було б надміром, а так перехід між вкладками не тягне зайвих запросів до
 * того, чого не видно.
 */
export function TeacherHome({
  session,
  onTimezoneChange,
}: {
  session: Session;
  onTimezoneChange: (timezone: string) => void;
}) {
  const [tab, setTab] = useState('schedule');

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-4">
      <TabsList>
        <TabsTrigger value="schedule">
          <CalendarDays aria-hidden />
          Розклад
        </TabsTrigger>
        <TabsTrigger value="students">
          <Users aria-hidden />
          Студенти
        </TabsTrigger>
        <TabsTrigger value="availability">
          <Clock aria-hidden />
          Доступність
        </TabsTrigger>
        <TabsTrigger value="payments">
          <CreditCard aria-hidden />
          Оплата
        </TabsTrigger>
      </TabsList>

      <TabsContent value="schedule">
        <TeacherSchedule session={session} />
      </TabsContent>
      <TabsContent value="students">
        <StudentsPanel session={session} />
      </TabsContent>
      <TabsContent value="availability">
        <AvailabilityPanel session={session} onTimezoneChange={onTimezoneChange} />
      </TabsContent>
      <TabsContent value="payments">
        <PaymentsPanel session={session} />
      </TabsContent>
    </Tabs>
  );
}
