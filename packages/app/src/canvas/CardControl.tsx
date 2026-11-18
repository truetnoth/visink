import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { canvasAtPath, isPlayerCard, type Card } from '@visink/core';
import { editAtomic, useStore } from '../store';
import { setCardEntry } from '../cardEditing';
import { jumpTargets } from '../ops';

export type CardControlField = 'speaker' | 'repeat' | 'entry' | 'target';
export const REPEAT_OPTIONS = [{ value: 'once', label: 'Одноразовый' }, { value: 'sticky', label: 'Повторяемый' }, { value: 'fallback', label: 'Запасной' }] as const;

export function CardControl({ card, anchor }: { card: Card; anchor: HTMLElement }) {
  const request = useStore((s) => s.cardControl);
  const project = useStore((s) => s.project)!;
  const [query, setQuery] = useState('');
  const [entry, setEntry] = useState(card.entry ?? '');
  const [error, setError] = useState('');
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const ref = useRef<HTMLDivElement>(null);
  const close = () => { useStore.setState({ cardControl: null }); anchor.focus({ preventScroll: true }); };
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = Math.min(ref.current?.offsetHeight ?? 300, window.innerHeight - 16);
    setPosition({ left: Math.max(8, Math.min(r.left, window.innerWidth - 328)), top: Math.max(8, Math.min(r.bottom + 6, window.innerHeight - h - 8)) });
    ref.current?.querySelector<HTMLElement>('input, button')?.focus();
  }, []);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) useStore.setState({ cardControl: null }); };
    document.addEventListener('mousedown', down, true);
    const resize = () => useStore.setState({ cardControl: null });
    window.addEventListener('resize', resize);
    return () => { document.removeEventListener('mousedown', down, true); window.removeEventListener('resize', resize); };
  }, [anchor]);
  if (!request || request.card !== card.id) return null;
  const field = request.field;
  const titles = { speaker: 'Спикер', repeat: 'Тип ответа', entry: 'Дополнительная точка входа', target: 'Переход к' };
  const selection = useStore.getState().selection;
  const ids = selection.includes(card.id) ? selection : [card.id];
  const count = ids.length;
  const apply = (value: string) => {
    const { activeCanvas, flowPath } = useStore.getState();
    if (!activeCanvas) return;
    try {
      editAtomic((p) => {
        if (field === 'entry') { setCardEntry(p, activeCanvas, card.id, value); return; }
        const canvas = canvasAtPath(p.canvases[activeCanvas], flowPath);
        if (!canvas) return;
        for (const c of canvas.cards) {
          if (field === 'target') { if (c.id === card.id) c.target = value || undefined; }
          else if (ids.includes(c.id) && c.type === 'line') {
            if (field === 'speaker') c.speaker = value || undefined;
            if (field === 'repeat' && isPlayerCard(p, c)) c.repeat = value as Card['repeat'];
          }
        }
      });
      close();
    } catch (e) { setError((e as Error).message); }
  };
  const options = field === 'speaker' ? [{ value: '', label: 'Без спикера' }, ...project.entities.map((e) => ({ value: e.id, label: e.name }))] : field === 'repeat' ? [...REPEAT_OPTIONS] : field === 'target' ? [{ value: '', label: 'Цель не задана' }, ...jumpTargets(project)] : [];
  const filtered = options.filter((o) => o.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return createPortal(<div ref={ref} className="popup card-control-popup nodrag nopan nowheel" role="dialog" aria-label={titles[field]} style={position} onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(); } }}>
    <div className="card-control-title"><strong>{titles[field]}</strong><button aria-label="Закрыть" onClick={close}>×</button></div>
    {count > 1 && (field === 'speaker' || field === 'repeat') && <div className="muted">Для подходящих реплик в выделении ({count})</div>}
    {field === 'entry' ? <form onSubmit={(e) => { e.preventDefault(); apply(entry); }}><input aria-label="Имя точки входа" value={entry} spellCheck={false} onChange={(e) => setEntry(e.target.value)} placeholder="second_meeting" /><div className="row"><button type="button" onClick={close}>Отмена</button><button className="primary" type="submit">Сохранить</button></div></form> : <>
      {field !== 'repeat' && <input aria-label="Поиск" placeholder="Поиск…" value={query} onChange={(e) => setQuery(e.target.value)} />}
      <div className="card-control-options">{filtered.map((o) => <button key={o.value} className={card[field] === o.value ? 'on' : ''} onClick={() => apply(o.value)}>{o.label}</button>)}{!filtered.length && <div className="muted">Ничего не найдено</div>}</div>
    </>}
    {error && <div className="bad" role="alert">{error}</div>}
  </div>, document.body);
}
