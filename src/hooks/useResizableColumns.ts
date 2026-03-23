import { useState, useRef, useCallback } from 'react';

export function useResizableColumns(storageKey: string, defaults: Record<string, number>) {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
    } catch {
      return defaults;
    }
  });

  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  const startResize = useCallback((col: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = widthsRef.current[col] ?? defaults[col] ?? 100;

    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(50, startWidth + ev.clientX - startX);
      const next = { ...widthsRef.current, [col]: newWidth };
      widthsRef.current = next;
      setWidths(next);
    };

    const onUp = () => {
      localStorage.setItem(storageKey, JSON.stringify(widthsRef.current));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [storageKey, defaults]);

  return { widths, startResize };
}
