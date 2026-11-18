// Compatibility editor for logic attached to links in older projects.
import type { Canvas, Link, Project } from "@visink/core";
import { isPlayerCard, linkId } from "@visink/core";
import { useStore } from "../store";
import { deleteLink } from "../ops";
import { TYPE_LABEL } from "../CanvasView";
import { ExprField } from "./fields";
import type { Card } from "@visink/core";

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
