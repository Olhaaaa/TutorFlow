import type { CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * Тости. Канонічна версія від shadcn бере тему з next-themes — нам цей пакет
 * не потрібен: тему задає системна настройка, і sonner уміє читати її сам.
 * Кольори беремо з тих самих змінних, що й решта інтерфейсу.
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="system"
      position="bottom-right"
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
