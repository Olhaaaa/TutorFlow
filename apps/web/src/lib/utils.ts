import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Склеює класи Tailwind так, щоб пізніший переміг у конфлікті:
 * twMerge знає групи утиліт, тому `cn('p-2', 'p-4')` дає `p-4`, а не обидва.
 * Цього чекають усі компоненти shadcn/ui — вони приймають className ззовні.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
