import { cva } from 'class-variance-authority';

/**
 * Візуальна мова станів заняття: заливка, штриховка, пунктир, акцентна смуга.
 * Живе окремо від компонента, бо нею користуються і календар студента, і
 * кабінет викладача — а ще тому, що файл з одним лише компонентом дружній до
 * гарячого перезавантаження.
 */
export const slotBox = cva('relative flex rounded-md border border-l-4 text-left transition-all', {
  variants: {
    variant: {
      free: 'border-slot-free-border border-l-slot-free-border bg-slot-free text-slot-free-fg hover:border-l-primary hover:shadow-sm',
      unpaid:
        'slot-hatch-unpaid border-slot-unpaid-border/35 border-l-slot-unpaid-border bg-slot-unpaid text-slot-unpaid-fg',
      paid: 'border-slot-paid-border border-l-slot-paid-border bg-slot-paid text-slot-paid-fg shadow-sm',
      busy: 'border-slot-busy-border border-l-slot-busy-border bg-slot-busy text-slot-busy-fg',
      past: 'border-dashed border-slot-past-border border-l-slot-past-border bg-slot-past text-slot-past-fg',
      late: 'slot-hatch-late border-slot-late-border/45 border-l-slot-late-border bg-slot-late text-slot-late-fg',
    },
    shape: {
      // У клітинці ширина — дефіцит, тому час і стан стоять у два рядки:
      // в один рядок підпис «не оплачено» обрізався б на будь-якій сітці.
      cell: 'flex-col gap-0.5 px-2 py-1.5',
      row: 'flex-row items-center gap-3 px-3 py-3',
    },
  },
  defaultVariants: { variant: 'free', shape: 'cell' },
});
