// свойства файла (Canvas), проекта и персонажей (Entity)
import { useMemo, useState } from "react";
import type { Canvas, Entity, Project } from "@visink/core";
import { flowCards, isValidInkName } from "@visink/core";
import { useStore } from "../store";
import { askUser } from "../tauriFs";
import { jumpTargets, renameCanvas } from "../ops";
import { Combobox } from "../ui";
import { characterOptions, Field, PortraitPreview, Select, Text } from "./fields";
import { groupNames } from "./tree";

export function CanvasProps({ canvas, canvasKey, project }: { canvas: Canvas; canvasKey: string; project: Project }) {
  const { edit, setActiveCanvas } = useStore.getState();
  const [id, setId] = useState(canvas.id);
  const [prevKey, setPrevKey] = useState(canvasKey);
  if (prevKey !== canvasKey) {
    setPrevKey(canvasKey);
    setId(canvas.id);
  }
  const idTaken = id !== canvas.id && Object.values(project.canvases).some((c) => c.id === id);
  const applyId = () => {
    if (id === canvas.id || !isValidInkName(id) || idTaken) return;
    let key = "";
    edit((p) => (key = renameCanvas(p, canvasKey, { id })));
    setActiveCanvas(key);
  };
  return (
    <div className="props">
      <div className="props-title">Файл</div>
      <Field label="Название">
        <Text value={canvas.title} onChange={(v) => edit((p) => (p.canvases[canvasKey].title = v))} />
      </Field>
      <Field
        label="Имя файла и узла ink"
        hint={!isValidInkName(id) ? <span className="bad">только латиница, цифры и _</span> : idTaken ? <span className="bad">имя занято</span> : "переходы в этот файл обновятся сами"}
      >
        <input className="mono" spellCheck={false} autoCapitalize="off" autoCorrect="off" value={id} onChange={(e) => setId(e.target.value)} onBlur={applyId} onKeyDown={(e) => e.key === "Enter" && applyId()} />
      </Field>
      <Field label="Папка" hint="для порядка в списке файлов; на ink не влияет">
        <Combobox
          value={canvas.group ?? ""}
          options={groupNames(Object.values(project.canvases))}
          placeholder="Акт 1, Кампус…"
          onChange={(g) => edit((p) => (p.canvases[canvasKey].group = g || undefined))}
        />
      </Field>
      <Field label="Владелец" hint="главный собеседник: спикер новых реплик">
        <Select
          value={canvas.owner ?? ""}
          onChange={(v) => edit((p) => (p.canvases[canvasKey].owner = v || undefined))}
          options={characterOptions(project, "— не задан —").filter((o) => o.hint !== "игрок")}
        />
      </Field>
      <button
        className="danger"
        onClick={async () => {
          if (!(await askUser(`Удалить файл «${canvas.title}»? Отменить можно через Ctrl+Z.`))) return;
          edit((p) => delete p.canvases[canvasKey]);
          setActiveCanvas(null);
        }}
      >
        Удалить файл
      </button>
    </div>
  );
}

export function ProjectProps({ project }: { project: Project }) {
  const { edit, pickBuildDir } = useStore.getState();
  const buildFs = useStore((s) => s.buildFs);
  const targets = useMemo(() => jumpTargets(project), [project]);
  return (
    <div className="props">
      <div className="props-title">Проект</div>
      <Field label="Название">
        <Text value={project.settings.name} onChange={(v) => edit((p) => (p.settings.name = v))} />
      </Field>
      <Field
        label="Запуск всей истории"
        hint="куда переходит main.ink — для Inky и прогона всей истории. Godot запускает диалоги сам: ChoosePathString(&quot;файл&quot;). Пусто — история сразу заканчивается."
      >
        <Combobox mono value={project.settings.start ?? ""} options={targets} placeholder="например, dean" onChange={(v) => edit((p) => (p.settings.start = v || undefined))} />
      </Field>
      <Field label="Папка сборки внутри проекта" hint={buildFs ? `сейчас сборка пишется во внешнюю папку «${buildFs.name}»` : undefined}>
        <Text mono value={project.settings.buildDir} onChange={(v) => edit((p) => (p.settings.buildDir = v))} />
      </Field>
      <button onClick={pickBuildDir}>Собирать во внешнюю папку…</button>
    </div>
  );
}

export function EntityProps({ entity, project }: { entity: Entity; project: Project }) {
  const { edit, selectEntity } = useStore.getState();
  const set = <K extends keyof Entity>(field: K, value: Entity[K]) =>
    edit((p) => {
      const e = p.entities.find((x) => x.id === entity.id);
      if (!e) return;
      if (field === "isPlayer" && value) for (const other of p.entities) other.isPlayer = undefined;
      e[field] = value;
    });
  const uses = Object.values(project.canvases).reduce((n, c) => n + flowCards(c).filter((x) => x.card.speaker === entity.id).length, 0);
  return (
    <div className="props">
      <div className="props-title">
        Персонаж <span className="mono muted">{entity.id}</span>
      </div>
      <Field label="Имя">
        <Text value={entity.name} onChange={(v) => set("name", v)} />
      </Field>
      <Field label="Имя в ink" hint="«ДЕКАН: текст»; пусто — строка без префикса (рассказчик)">
        <Text value={entity.inkName} onChange={(v) => set("inkName", v)} />
      </Field>
      <Field label="Цвет">
        <input type="color" value={entity.color} onChange={(e) => set("color", e.target.value)} />
      </Field>
      <Field label="Папка" hint="для порядка в списке персонажей">
        <Combobox value={entity.group ?? ""} options={groupNames(project.entities)} placeholder="Преподаватели, Студенты…" onChange={(g) => set("group", g || undefined)} />
      </Field>
      <Field label="Портрет" hint="путь в проекте, уходит в manifest.json">
        <div className="portrait-row">
          <PortraitPreview entity={entity} />
          <Text mono value={entity.portrait ?? ""} placeholder="assets/portraits/dean.png" onChange={(v) => set("portrait", v || undefined)} />
        </div>
      </Field>
      <label className="check">
        <input type="checkbox" checked={!!entity.isPlayer} onChange={(e) => set("isPlayer", e.target.checked || undefined)} />
        Это игрок — его реплики становятся вариантами выбора
      </label>
      <div className="muted pad">Реплик: {uses}</div>
      <button
        className="danger"
        disabled={uses > 0}
        title={uses ? "Сначала уберите персонажа из реплик" : ""}
        onClick={() => {
          edit((p) => (p.entities = p.entities.filter((e) => e.id !== entity.id)));
          selectEntity(null);
        }}
      >
        Удалить персонажа
      </button>
    </div>
  );
}
