import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { canvasAtPath, isPlayerCard, type Card, type CardInput, type VarType } from '@visink/core';
import { editAtomic, useStore } from '../store';
import { setCardEntry } from '../cardEditing';
import { jumpTargets } from '../ops';

export type CardControlField = 'repeat' | 'entry' | 'target' | 'inputs';
export const REPEAT_OPTIONS = [{ value: 'once', label: 'Одноразовый' }, { value: 'sticky', label: 'Повторяемый' }, { value: 'fallback', label: 'Запасной' }] as const;

type InputDraft = Omit<CardInput, 'default'> & { default: string };

function inputWithDefault(input: InputDraft): CardInput {
  if (input.type === 'string') return input;
  if (input.type === 'bool') return { ...input, default: input.default === 'true' };
  const value = Number(input.default.trim().replace(',', '.'));
  if (!input.default.trim() || !Number.isFinite(value) || input.type === 'int' && !Number.isInteger(value)) {
    throw new Error(`Укажите ${input.type === 'int' ? 'целое число' : 'число'} для ${input.name}`);
  }
  return { ...input, default: value };
}

export function CardControl({ card, anchor }: { card: Card; anchor: HTMLElement }) {
  const request = useStore((s) => s.cardControl);
  const project = useStore((s) => s.project)!;
  const [query, setQuery] = useState('');
  const [entry, setEntry] = useState(card.entry ?? '');
  const [inputs, setInputs] = useState<InputDraft[]>(() => (card.inputs ?? []).map((input) => ({ ...input, default: String(input.default) })));
  const inputNumber = useRef(Math.max(0, ...(card.inputs ?? []).map((input) => Number(input.name.match(/^input_(\d+)$/)?.[1] ?? 0))) + 1);
  const [error, setError] = useState('');
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const ref = useRef<HTMLDivElement>(null);
  const targets = useMemo(() => request?.field === 'target' ? jumpTargets(project) : [], [request?.field, project]);
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
  const titles = { repeat: 'Тип ответа', entry: 'Дополнительная точка входа', target: 'Переход к', inputs: 'Входы карточки' };
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
          else if (ids.includes(c.id) && c.type === 'line' && field === 'repeat' && isPlayerCard(p, c)) c.repeat = value as Card['repeat'];
        }
      });
      close();
    } catch (e) { setError((e as Error).message); }
  };
  const saveInputs = () => {
    try {
      const next = inputs.map(inputWithDefault);
      const retained = new Set(next.map((input) => input.name));
      editAtomic((p) => {
        const { activeCanvas, flowPath } = useStore.getState();
        const canvas = activeCanvas ? canvasAtPath(p.canvases[activeCanvas], flowPath) : undefined;
        const target = canvas?.cards.find((item) => item.id === card.id);
        if (!canvas || !target) return;
        if (next.length) target.inputs = next;
        else delete target.inputs;
        for (const link of canvas.links) {
          if (link.to !== card.id || !link.args) continue;
          const args = Object.fromEntries(Object.entries(link.args).filter(([name]) => retained.has(name)));
          if (Object.keys(args).length) link.args = args;
          else delete link.args;
        }
      });
      close();
    } catch (e) { setError((e as Error).message); }
  };
  const options: { value: string; label: string; aliases?: string[] }[] = field === 'repeat' ? REPEAT_OPTIONS.map((option) => ({ ...option })) : field === 'target' ? [{ value: '', label: 'Цель не задана' }, ...targets] : [];
  const filtered = options.filter((o) => [o.label, o.value, ...(o.aliases ?? [])].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return createPortal(<div ref={ref} className="popup card-control-popup nodrag nopan nowheel" role="dialog" aria-label={titles[field]} style={position} onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(); } }}>
    <div className="card-control-title"><strong>{titles[field]}</strong><button aria-label="Закрыть" onClick={close}>×</button></div>
    {count > 1 && field === 'repeat' && <div className="muted">Для подходящих реплик в выделении ({count})</div>}
    {field === 'inputs' ? <form onSubmit={(e) => { e.preventDefault(); saveInputs(); }}>
      <div className="card-inputs">{inputs.map((input, index) => <div className="card-input-row" key={input.name}>
        <span className="mono">{input.name}</span>
        <select aria-label={`Тип ${input.name}`} value={input.type} onChange={(e) => {
          const type = e.target.value as VarType;
          setInputs(inputs.map((item, i) => i === index ? { ...item, type, default: type === 'bool' ? 'false' : type === 'string' ? '' : '0' } : item));
        }}><option value="int">int</option><option value="float">float</option><option value="bool">bool</option><option value="string">string</option></select>
        {input.type === 'bool'
          ? <select aria-label={`Значение по умолчанию для ${input.name}`} value={input.default} onChange={(e) => setInputs(inputs.map((item, i) => i === index ? { ...item, default: e.target.value } : item))}><option value="false">false</option><option value="true">true</option></select>
          : <input aria-label={`Значение по умолчанию для ${input.name}`} inputMode={input.type === 'string' ? 'text' : 'decimal'} value={input.default} onChange={(e) => setInputs(inputs.map((item, i) => i === index ? { ...item, default: e.target.value } : item))} />}
        <button type="button" aria-label={`Удалить ${input.name}`} onClick={() => setInputs(inputs.filter((_, i) => i !== index))}>×</button>
      </div>)}</div>
      <button type="button" onClick={() => setInputs([...inputs, { name: `input_${inputNumber.current++}`, type: 'int', default: '0' }])}>Добавить вход</button>
      <div className="row"><button type="button" onClick={close}>Отмена</button><button className="primary" type="submit">Сохранить</button></div>
    </form> : field === 'entry' ? <form onSubmit={(e) => { e.preventDefault(); apply(entry); }}><input aria-label="Имя точки входа" value={entry} spellCheck={false} onChange={(e) => setEntry(e.target.value)} placeholder="second_meeting" /><div className="row"><button type="button" onClick={close}>Отмена</button><button className="primary" type="submit">Сохранить</button></div></form> : <>
      {field !== 'repeat' && <input aria-label="Поиск" placeholder="Поиск…" value={query} spellCheck={false} autoCapitalize="off" autoCorrect="off" onChange={(e) => setQuery(e.target.value)} />}
      <div className="card-control-options">{filtered.map((o) => <button key={o.value} className={card[field] === o.value || field === 'target' && o.aliases?.includes(card.target ?? '') ? 'on' : ''} onClick={() => apply(o.value)}>{o.label}</button>)}{!filtered.length && <div className="muted">Ничего не найдено</div>}</div>
    </>}
    {error && <div className="bad" role="alert">{error}</div>}
  </div>, document.body);
}
