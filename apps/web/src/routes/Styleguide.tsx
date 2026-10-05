import { ArrowLeft } from 'lucide-react';
import type { SlotView } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Slot } from '@/features/calendar/Slot';
import { ALL_STATES, STATE } from '@/features/calendar/slot-state';

/**
 * Сторінка стилів. Малює всі стани слота поруч — це водночас специфікація для
 * тих, хто пише екрани, і скріншот для звіту, який не може розійтися з
 * реалізацією, бо бере ті самі компоненти й ті самі змінні кольору.
 */
const SAMPLE = (state: SlotView['state'], i: number): SlotView => ({
  id: -i,
  startAt: '2026-10-21T13:00:00.000Z',
  endAt: '2026-10-21T14:00:00.000Z',
  priceMinor: 50000,
  state,
  payBy: state === 'mine_unpaid' ? '2026-10-20T13:00:00.000Z' : null,
});

/** Зразки показують не лише колір, а й подачу: заливку, штриховку, пунктир. */
const SWATCHES = [
  { name: 'primary', className: 'bg-primary' },
  { name: 'accent', className: 'bg-accent' },
  { name: 'slot-paid', className: 'bg-slot-paid border-l-4 border-slot-paid-border' },
  {
    name: 'slot-unpaid',
    className: 'slot-hatch-unpaid bg-slot-unpaid border-l-4 border-slot-unpaid-border',
  },
  {
    name: 'slot-late',
    className: 'slot-hatch-late bg-slot-late border-l-4 border-slot-late-border',
  },
  { name: 'slot-past', className: 'border-dashed border-slot-past-border bg-slot-past' },
];

export function Styleguide({ tz }: { tz: string }) {
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <a href="#">
          <ArrowLeft aria-hidden />
          до календаря
        </a>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Палітра</CardTitle>
          <CardDescription>
            Усі кольори — змінні в <code className="font-mono">index.css</code>, записані в oklch.
            Жоден екран не задає відтінок самостійно, тому світла й темна теми не розходяться.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {SWATCHES.map((s) => (
            <div key={s.name} className="space-y-1">
              <div className={`size-16 rounded-md border ${s.className}`} />
              <code className="font-mono text-xs text-muted-foreground">{s.name}</code>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Стани слота</CardTitle>
          <CardDescription>
            Шість станів, два форми: клітинка тижневої сітки й рядок списку дня.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              клітинка сітки
            </p>
            <div className="flex flex-wrap gap-3">
              {ALL_STATES.map((s, i) => (
                <div key={s} className="w-32 space-y-1">
                  <code className="block font-mono text-xs text-muted-foreground">{s}</code>
                  <Slot slot={SAMPLE(s, i)} tz={tz} onAct={() => {}} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              рядок у списку дня
            </p>
            <div className="max-w-md space-y-2">
              {ALL_STATES.map((s, i) => (
                <Slot key={s} slot={SAMPLE(s, i)} tz={tz} shape="row" onAct={() => {}} />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Дія і пояснення для кожного стану</CardTitle>
          <CardDescription>
            Підказка показується у підказці наведення — користувач не має здогадуватись, чому
            кнопки немає.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>стан</TableHead>
                <TableHead>підпис</TableHead>
                <TableHead>дія</TableHead>
                <TableHead>пояснення</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ALL_STATES.map((s) => (
                <TableRow key={s}>
                  <TableCell>
                    <code className="font-mono text-xs">{s}</code>
                  </TableCell>
                  <TableCell>{STATE[s].label}</TableCell>
                  <TableCell>
                    <code className="font-mono text-xs">{STATE[s].action ?? '—'}</code>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{STATE[s].hint}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
