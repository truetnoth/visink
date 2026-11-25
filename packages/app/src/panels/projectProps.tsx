import { NamespaceField } from "../NamespaceField";
// свойства файла (Canvas), проекта и персонажей (Entity)
import { useRef, useState } from "react";
import type { Canvas, Entity, Project } from "@visink/core";
import { canvasAtPath, canvasLocations, flowCards, isValidInkName } from "@visink/core";
import { editAtomic, useStore } from "../store";
import { deleteEntity } from "../organization";
import { askUser } from "../tauriFs";
import { deleteCards, renameNestedCanvas } from "../ops";
import { characterOptions, Field, PortraitPreview, Select, Text } from "./fields";

export function CanvasProps({ canvas, canvasKey, project }: { canvas: Canvas; canvasKey: string; project: Project }) {
  const { edit, setActiveCanvas } = useStore.getState();
  const flowPath = useStore((s) => s.flowPath);
  const nested = flowPath.length > 0;
  const [id, setId] = useState(canvas.id);
  const [prevKey, setPrevKey] = useState(canvasKey);
  const identity = `${canvasKey}:${flowPath.join("/")}`;
  if (prevKey !== identity) {
    setPrevKey(identity);
    setId(canvas.id);
  }
  const idTaken = id !== canvas.id && (["main", "globals"].includes(id.toLowerCase()) || canvasLocations(project).some(({ canvas: c }) => c.id.toLowerCase() === id.toLowerCase()));
  const applyId = () => {
    if (!nested || id === canvas.id || !isValidInkName(id) || idTaken) return;
    edit((p) => renameNestedCanvas(p, flowPath, id));
    setActiveCanvas(canvasKey, flowPath);
  };
  return (
    <div className="props">
      <div className="props-title">Файл</div>
      <Field label="Название">
        <Text value={canvas.title} onChange={(v) => edit((p) => {
          const current = canvasAtPath(p.canvases[canvasKey], flowPath);
          if (!current) return;
          current.title = v;
          if (!nested && current.id === "main") p.settings.name = v;
          if (nested) {
            const parent = canvasAtPath(p.canvases[canvasKey], flowPath.slice(0, -1));
            const owner = parent?.cards.find((card) => card.id === flowPath.at(-1));
            if (owner?.type === "flow") owner.text = v;
          }
        })} />
      </Field>
      <Field
        label="Имя файла и узла ink"
        hint={!isValidInkName(id) ? <span className="bad">только латиница, цифры и _</span> : idTaken ? <span className="bad">имя занято</span> : "переходы в этот файл обновятся сами"}
      >
        <input className="mono" spellCheck={false} autoCapitalize="off" autoCorrect="off" value={id} disabled={!nested} onChange={(e) => setId(e.target.value)} onBlur={applyId} onKeyDown={(e) => e.key === "Enter" && applyId()} />
      </Field>
      <Field label="Владелец" hint="главный собеседник: спикер новых реплик">
        <Select
          value={canvas.owner ?? ""}
          onChange={(v) => edit((p) => {
            const current = canvasAtPath(p.canvases[canvasKey], flowPath);
            if (current) current.owner = v || undefined;
          })}
          options={characterOptions(project, "— не задан —").filter((o) => o.hint !== "игрок")}
        />
      </Field>
      {nested && <button
        className="danger"
        onClick={async () => {
          if (!(await askUser(`Удалить вложенность «${canvas.title}»? Отменить можно через Ctrl+Z.`))) return;
          edit((p) => {
            const parent = canvasAtPath(p.canvases[canvasKey], flowPath.slice(0, -1));
            if (parent) deleteCards(parent, [flowPath.at(-1)!]);
          });
          setActiveCanvas(canvasKey, flowPath.slice(0, -1));
        }}
      >
        Удалить вложенность
      </button>}
    </div>
  );
}

export function ProjectProps({ project }: { project: Project }) {
  const { edit, pickBuildDir } = useStore.getState();
  const buildFs = useStore((s) => s.buildFs);
  return (
    <div className="props">
      <div className="props-title">Проект</div>
      <Field label="Название">
        <Text value={project.settings.name} onChange={(v) => edit((p) => {
          p.settings.name = v;
          if (p.canvases.main) p.canvases.main.title = v;
        })} />
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
  const owned = [...project.variables.vars, ...project.variables.lists, ...project.variables.functions].some((v) => v.owner === entity.id);
  const [deleteError, setDeleteError] = useState("");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(entity.name);
  const cancelled = useRef(false);
  const startName = () => { cancelled.current = false; setName(entity.name); setNaming(true); };
  const commitName = () => { if (!cancelled.current && name.trim()) set("name", name.trim()); setNaming(false); };
  return (
    <div className="props entity-props">
      {naming ? <input className="entity-title-input" aria-label="Имя сущности" autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={(e) => { if (e.key === "Enter") commitName(); if (e.key === "Escape") { cancelled.current = true; setNaming(false); } }} /> : <h2 className="entity-title" tabIndex={0} title="Двойной щелчок — переименовать" onDoubleClick={startName} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "F2") startName(); }}>{entity.name}</h2>}
      <div className="entity-intro"><PortraitPreview entity={entity} /><textarea aria-label="Описание сущности" placeholder="Описание" rows={3} value={entity.description ?? ""} onChange={(e) => set("description", e.target.value || undefined)} /></div>
      <div className="entity-fields">
        <NamespaceField key={entity.id} project={project} id={entity.id} />
        <Field label="Имя в ink"><Text value={entity.inkName} onChange={(v) => set("inkName", v)} /></Field>
        <Field label="Портрет"><Text value={entity.portrait ?? ""} placeholder="assets/portraits/dean.png" onChange={(v) => set("portrait", v || undefined)} /></Field>
        <Field label="Цвет"><input type="color" value={entity.color} onChange={(e) => set("color", e.target.value)} /></Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={!!entity.isPlayer} onChange={(e) => set("isPlayer", e.target.checked || undefined)} />
        Это игрок — его реплики становятся вариантами выбора
      </label>
      <div className="muted pad">Реплик: {uses}</div>
      <button
        className="danger"
        disabled={owned}
        title={owned ? "Сначала удалите собственные переменные, LIST и функции сущности" : uses ? "Спикер связанных реплик будет заменён на рассказчика" : undefined}
        onClick={() => {
          try {
            editAtomic((p) => deleteEntity(p, entity.id));
            setDeleteError("");
            selectEntity(null);
          } catch (e) {
            setDeleteError((e as Error).message);
          }
        }}
      >
        Удалить сущность
      </button>
      {deleteError && <div className="bad" role="alert">{deleteError}</div>}
    </div>
  );
}
