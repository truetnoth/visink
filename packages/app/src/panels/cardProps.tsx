// свойства карточек и стрелок: одна карточка, стрелка, групповое редактирование
import { useMemo, useState } from "react";
import type { Card, CardType, Canvas, Link, Project, Repeat, TextStatus } from "@visink/core";
import { flowCards, isPlayerCard, isValidInkName, linkId } from "@visink/core";
import { Flag } from "lucide-react";
import { useStore } from "../store";
import { deleteCards, deleteLink, jumpTargets } from "../ops";
import { TYPE_LABEL } from "../CanvasView";
import { Combobox } from "../ui";
import { characterOptions, ExprField, Field, Select, Text } from "./fields";

export function CardProps({ card, canvas, canvasKey, project }: { card: Card; canvas: Canvas; canvasKey: string; project: Project }) {
  const check = useStore((s) => s.check);
  const { editCanvas, focusCard } = useStore.getState();
  const set = <K extends keyof Card>(field: K, value: Card[K]) =>
    editCanvas((c) => {
      const target = c.cards.find((x) => x.id === card.id);
      if (!target) return;
      if (value === "" || value === undefined) delete target[field];
      else target[field] = value;
    });
  const player = isPlayerCard(project, card);
  const problems = (check?.diagnostics ?? []).filter((d) => d.canvas === canvasKey && d.card === card.id);
  const incoming = useMemo(() => {
    const out: { key: string; canvas: Canvas; card: Card }[] = [];
    for (const l of canvas.links.filter((l) => l.to === card.id)) {
      const from = canvas.cards.find((c) => c.id === l.from);
      if (from) out.push({ key: canvasKey, canvas, card: from });
    }
    for (const [k, c] of Object.entries(project.canvases)) {
      for (const { canvas: flow, card: j } of flowCards(c)) {
        if (j.type !== "jump" || !j.target) continue;
        const [cid, sub] = j.target.split(".");
        if (cid === canvas.id && (sub === card.id || (card.entry && sub === `entry_${card.entry}`) || (card.entry && sub === card.entry))) out.push({ key: k, canvas: flow, card: j });
      }
    }
    return out;
  }, [project, canvas, canvasKey, card]);
  const targets = useMemo(() => jumpTargets(project), [project]);

  return (
    <div className="props">
      <div className="props-title">
        {TYPE_LABEL[card.type]} <span className="mono muted">{canvas.id}.{card.id}</span>
      </div>
      {problems.map((d, i) => (
        <div key={i} className={`problem ${d.severity}`}>{d.message}</div>
      ))}
      {canvas.links.filter((l) => l.from === card.id && !l.port).length > 1 && (
        <div className="field-hint pad">Несколько стрелок: варианты в меню и проверка веток идут сверху вниз по положению карточек.</div>
      )}
      <Field label="Тип">
        <Select<CardType> value={card.type} onChange={(t) => set("type", t)} options={(Object.keys(TYPE_LABEL) as CardType[]).filter((t) => (t === "flow") === (card.type === "flow")).map((t) => [t, TYPE_LABEL[t]])} />
      </Field>
      {(card.type === "flow" || card.type === "hub") && <Field label="Название" hint={card.type === "flow" ? "Двойной щелчок по телу открывает содержимое. Внутренние концы автоматически ведут на выходы этой карточки." : "Показывается на карточке и в списке целей перехода."}>
        <Text value={card.text ?? ""} placeholder={card.type === "flow" ? "Новая вложенность" : "Новый хаб"} onChange={(v) => set("text", v)} />
      </Field>}

      {canvas.start === card.id ? (
        <div className="start-note">
          <Flag size={14} /> Начало файла — с этой карточки игра начинает <span className="mono">{canvas.id}</span>
        </div>
      ) : (
        <button className="wide start-btn" onClick={() => editCanvas((c) => (c.start = card.id))}>
          <Flag size={14} /> Сделать началом файла
        </button>
      )}
      <details className="more" open={!!card.entry}>
        <summary>Дополнительная точка входа</summary>
        <Field
          label="Имя точки входа"
          hint={
            card.entry && !isValidInkName(card.entry) ? (
              <span className="bad">только латиница, цифры и _</span>
            ) : card.entry ? (
              <>игра может начать отсюда: <span className="mono">{canvas.id}.entry_{card.entry}</span></>
            ) : (
              <>чтобы игра могла начать диалог не с начала файла, например со второй встречи</>
            )
          }
        >
          <Text mono value={card.entry ?? ""} placeholder="second_meeting" onChange={(v) => set("entry", v.trim())} />
        </Field>
      </details>

      {card.type === "line" && (
        <>
          <Field label="Спикер">
            <Select value={card.speaker ?? ""} onChange={(v) => set("speaker", v)} options={characterOptions(project)} />
          </Field>
          {player && (
            <Field label="Текст на кнопке" hint="что игрок видит в меню выбора; пусто — текст реплики">
              <Text value={card.menuText ?? ""} placeholder={card.text || ""} onChange={(v) => set("menuText", v)} />
            </Field>
          )}
          <Field label="Текст реплики">
            <Text multiline rows={4} value={card.text ?? ""} onChange={(v) => set("text", v)} />
          </Field>
          {player && (
            <Field label="Повтор">
              <Select value={card.repeat ?? "once"} onChange={(v) => set("repeat", v)} options={[["once", "одноразовая (*)"], ["sticky", "повторяемая (+)"], ["fallback", "запасная (* ->)"]]} />
            </Field>
          )}
          <div className="row2">
            <Field label="Эмоция">
              <Text value={card.emotion ?? ""} onChange={(v) => set("emotion", v)} />
            </Field>
            <Field label="Статус">
              <Select value={card.status ?? "draft"} onChange={(v) => set("status", v)} options={[["draft", "черновик"], ["review", "на вычитке"], ["final", "финал"]]} />
            </Field>
          </div>
          <Field label="Ремарка" hint="тег # dir:">
            <Text value={card.stageDirection ?? ""} onChange={(v) => set("stageDirection", v)} />
          </Field>
        </>
      )}

      {card.type === "condition" ? (
        <ExprField label="Условие (выход «да», иначе «нет»)" value={card.condition ?? ""} onChange={(v) => set("condition", v)} project={project} />
      ) : (
        <div data-field="condition">
          <ExprField label="Входной пин — условие" value={card.condition ?? ""} onChange={(v) => set("condition", v)} project={project} />
        </div>
      )}

      {card.type !== "ink" && (
        <div data-field="action">
          <ExprField label="Выходной пин — действие (~ …), по строке" value={card.action ?? ""} onChange={(v) => set("action", v)} project={project} multiline />
        </div>
      )}

      {card.type === "jump" && (
        <Field label="Цель перехода" hint="Файл, точка входа или любая карточка, включая хабы и содержимое вложенностей. Ctrl+щелчок по переходу — открыть цель.">
          <Combobox mono value={card.target ?? ""} options={targets} placeholder="Выберите файл или карточку" onChange={(v) => set("target", v)} />
        </Field>
      )}

      {card.type === "ink" && (
        <ExprField
          label="Чистый ink"
          hint="вставляется как есть; со стрелками в конце дописывается переход. Конец игры — -> END, возврат из туннеля — ->->"
          multiline
          rows={8}
          value={card.text ?? ""}
          onChange={(v) => set("text", v)}
          project={project}
          noCheck
        />
      )}

      {card.type === "line" && (
        <Field label="Теги" hint="по строке: ключ: значение">
          <TagsEditor tags={card.tags ?? {}} onChange={(t) => set("tags", Object.keys(t).length ? t : undefined)} />
        </Field>
      )}

      <Field label="Заметка">
        <Text multiline rows={2} value={card.note ?? ""} onChange={(v) => set("note", v)} />
      </Field>

      {incoming.length > 0 && (
        <Field label="Кто ссылается">
          <ul className="tree compact-refs">
            {incoming.map(({ key, card: from }) => {
              const speaker = project.entities.find((e) => e.id === from.speaker);
              return <li key={key + from.id} onClick={() => focusCard(key, from.id)} title={from.id}>
                <span className="swatch" style={{ background: speaker?.color ?? "var(--service)" }} />
                {speaker?.name ?? TYPE_LABEL[from.type]}
              </li>;
            })}
          </ul>
        </Field>
      )}
    </div>
  );
}

export function LinkProps({ link, canvas, canvasKey, project }: { link: Link; canvas: Canvas; canvasKey: string; project: Project }) {
  const check = useStore((s) => s.check);
  const { editCanvas, setSelection } = useStore.getState();
  const same = (l: { from: string; to: string; port?: string }) => linkId(l) === linkId(link);
  const set = (field: "condition" | "action", value: string) =>
    editCanvas((c) => {
      const target = c.links.find(same);
      if (!target) return;
      if (value) target[field] = value;
      else delete target[field];
    });
  const from = canvas.cards.find((c) => c.id === link.from);
  const to = canvas.cards.find((c) => c.id === link.to);
  const label = (c?: Card) => (c ? c.menuText || c.text || TYPE_LABEL[c.type] : "?");
  const toPlayer = !!to && isPlayerCard(project, to);
  const problems = (check?.diagnostics ?? []).filter((d) => d.canvas === canvasKey && d.link && same(d.link as Link));
  return (
    <div className="props link-props">
      <div className="props-title">Стрелка</div>
      <div className="link-ends muted">
        <span className="mono">{link.from}</span> {label(from)} → <span className="mono">{link.to}</span> {label(to)}
        {link.port && <> · выход «{link.port === "yes" ? "да" : "нет"}»</>}
      </div>
      {problems.map((d, i) => (
        <div key={i} className={`problem ${d.severity}`}>{d.message}</div>
      ))}
      {/* логика живёт на пинах карточек; на стрелке — только то, что не удалось перенести из старых проектов */}
      {(link.condition || link.action) && (
        <div className="field-hint pad">осталось со старой версии — перенесите на пин карточки и очистите поле</div>
      )}
      {link.condition && (
        <ExprField
          label={toPlayer ? "Условие — когда показывать вариант" : "Условие — когда идти по стрелке"}
          value={link.condition}
          onChange={(v) => set("condition", v)}
          project={project}
        />
      )}
      {link.action && (
        <ExprField label="Действие при переходе (~ …), по строке" value={link.action} onChange={(v) => set("action", v)} project={project} multiline />
      )}
      {!link.condition && !link.action && <div className="field-hint pad">условие — щелчок по входному пину, действие — двойной щелчок по выходному</div>}
      <button
        className="danger"
        onClick={() => {
          editCanvas((c) => deleteLink(c, link.from, link.to, link.port));
          setSelection([]);
        }}
      >
        Удалить стрелку
      </button>
    </div>
  );
}

const MIXED = "\u0000mixed";

/** Общее значение поля у выбранных карточек или MIXED, если разные. */
function common<T>(cards: Card[], get: (c: Card) => T): T | typeof MIXED {
  const first = get(cards[0]);
  return cards.every((c) => get(c) === first) ? first : MIXED;
}

export function MultiCardProps({ canvas, selection, project }: { canvas: Canvas; selection: string[]; project: Project }) {
  const { editCanvas, setSelection } = useStore.getState();
  const cards = canvas.cards.filter((c) => selection.includes(c.id));
  const lines = cards.filter((c) => c.type === "line");
  const players = lines.filter((c) => isPlayerCard(project, c));
  const notes = selection.length - cards.length;
  // одна правка — один шаг отмены для всех карточек
  const setAll = <K extends keyof Card>(field: K, value: Card[K], only: (c: Card) => boolean = () => true) =>
    editCanvas((c) => {
      for (const target of c.cards) {
        if (!selection.includes(target.id) || !only(target)) continue;
        if (value === "" || value === undefined) delete target[field];
        else target[field] = value;
      }
    });
  const isLine = (c: Card) => c.type === "line";
  const isPlayer = (c: Card) => isPlayerCard(project, c);

  if (!cards.length) return <div className="muted pad">Выделено заметок: {notes}</div>;
  const speaker = lines.length ? common(lines, (c) => c.speaker ?? "") : MIXED;
  const emotion = lines.length ? common(lines, (c) => c.emotion ?? "") : MIXED;
  const status = lines.length ? common(lines, (c) => c.status ?? "draft") : MIXED;
  const repeat = players.length ? common(players, (c) => c.repeat ?? "once") : MIXED;
  const gated = cards.filter((c) => c.type !== "condition");
  const condition = gated.length ? common(gated, (c) => c.condition ?? "") : MIXED;
  const cardType = common(cards, (c) => c.type);
  const flowKind = cards.every((c) => c.type === "flow") ? true : cards.every((c) => c.type !== "flow") ? false : null;
  const typeOptions = flowKind === null ? [] : (Object.keys(TYPE_LABEL) as CardType[]).filter((type) => (type === "flow") === flowKind);

  return (
    <div className="props">
      <div className="props-title">
        Выбрано карточек: {cards.length}
        {notes > 0 && <span className="muted"> + заметок: {notes}</span>}
      </div>
      {typeOptions.length > 0 && <Field label="Тип всех выбранных">
        <Select<CardType> value={cardType === MIXED ? null : cardType} onChange={(type) => setAll("type", type)} options={typeOptions.map((type) => [type, TYPE_LABEL[type]])} />
      </Field>}
      {lines.length > 0 && (
        <>
          <Field label={`Спикер (реплик: ${lines.length})`}>
            <Select value={speaker === MIXED ? null : speaker} onChange={(v) => setAll("speaker", v, isLine)} options={characterOptions(project)} />
          </Field>
          <div className="row2">
            <Field label="Эмоция">
              <input
                value={emotion === MIXED ? "" : emotion}
                placeholder={emotion === MIXED ? "— разные —" : ""}
                onChange={(e) => setAll("emotion", e.target.value, isLine)}
              />
            </Field>
            <Field label="Статус">
              <Select<TextStatus>
                value={status === MIXED ? null : status}
                onChange={(v) => setAll("status", v, isLine)}
                options={[["draft", "черновик"], ["review", "на вычитке"], ["final", "финал"]]}
              />
            </Field>
          </div>
        </>
      )}
      {players.length > 0 && (
        <Field label={`Повтор (вариантов игрока: ${players.length})`}>
          <Select<Repeat>
            value={repeat === MIXED ? null : repeat}
            onChange={(v) => setAll("repeat", v, isPlayer)}
            options={[["once", "одноразовая (*)"], ["sticky", "повторяемая (+)"], ["fallback", "запасная (* ->)"]]}
          />
        </Field>
      )}
      {gated.length > 0 && (
        <Field label="Входной пин — условие" hint={condition === MIXED ? "у карточек разные условия — ввод заменит их все" : undefined}>
          <input
            className="mono"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
            value={condition === MIXED ? "" : condition}
            placeholder={condition === MIXED ? "— разные —" : ""}
            onChange={(e) => setAll("condition", e.target.value, (c) => c.type !== "condition")}
          />
        </Field>
      )}
      <Field label="Добавить тег всем" hint="ключ: значение, Enter">
        <input
          className="mono"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="voice: whisper"
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const m = /^\s*([^:]+?)\s*:\s*(.*)$/.exec(e.currentTarget.value);
            if (!m) return;
            const [, k, v] = m;
            editCanvas((c) => {
              for (const t of c.cards) if (selection.includes(t.id) && t.type === "line") t.tags = { ...t.tags, [k]: v };
            });
            e.currentTarget.value = "";
          }}
        />
      </Field>
      <div className="muted pad">Ctrl+1…9 — сменить спикера, Shift+щелчок — добавить к выделению.</div>
      <button
        className="danger"
        onClick={() => {
          editCanvas((c) => deleteCards(c, selection));
          setSelection([]);
        }}
      >
        Удалить выбранные
      </button>
    </div>
  );
}

function TagsEditor({ tags, onChange }: { tags: Record<string, string>; onChange: (t: Record<string, string>) => void }) {
  const [text, setText] = useState(() => Object.entries(tags).map(([k, v]) => `${k}: ${v}`).join("\n"));
  return (
    <textarea
      className="mono"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
      rows={2}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const out: Record<string, string> = {};
        for (const line of text.split("\n")) {
          const m = /^\s*([^:]+?)\s*:\s*(.*)$/.exec(line);
          if (m && m[1]) out[m[1]] = m[2];
        }
        onChange(out);
      }}
    />
  );
}
