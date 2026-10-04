import { useEffect, useState } from 'react';

/** Один breakpoint на весь застосунок: ширше — сітка тижня, вужче — список дня. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export const WIDE = '(min-width: 768px)';
