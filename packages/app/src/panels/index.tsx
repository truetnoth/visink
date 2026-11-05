// точка входа панелей: сборка свойств по текущему выделению + реэкспорт наружу
import { useStore } from "../store";
import { canvasAtPath, linkId } from "@visink/core";
import { VariableProps, ListProps, FunctionProps } from "./logicProps";
import { CardProps, LinkProps, MultiCardProps } from "./cardProps";
import { CanvasProps, ProjectProps, EntityProps } from "./projectProps";

export function Properties() {
  const project = useStore((s) => s.project)!;
  const key = useStore((s) => s.activeCanvas);
  const selection = useStore((s) => s.selection);
  const selectedEntity = useStore((s) => s.selectedEntity);
  const selectedLink = useStore((s) => s.selectedLink);
  const inspect = useStore((s) => s.inspect);
  const flowPath = useStore((s) => s.flowPath);
  const root = key ? project.canvases[key] : undefined;
  const canvas = root ? canvasAtPath(root, flowPath) : undefined;
  const link = canvas && selectedLink ? canvas.links.find((l) => linkId(l) === selectedLink) : undefined;
  const card = canvas && selection.length === 1 ? canvas.cards.find((c) => c.id === selection[0]) : undefined;
  const entity = selectedEntity ? project.entities.find((e) => e.id === selectedEntity) : undefined;

  return (
    <aside className="properties">
      {inspect?.kind === "var" ? (
        <VariableProps key={inspect.name} name={inspect.name} project={project} />
      ) : inspect?.kind === "list" ? (
        <ListProps key={inspect.name} name={inspect.name} project={project} />
      ) : inspect?.kind === "func" ? (
        <FunctionProps key={inspect.name} name={inspect.name} project={project} />
      ) : entity ? (
        <EntityProps entity={entity} project={project} />
      ) : link && canvas && key ? (
        <LinkProps key={selectedLink} link={link} canvas={canvas} canvasKey={key} project={project} />
      ) : card && canvas && key ? (
        <CardProps key={card.id} card={card} canvas={canvas} canvasKey={key} project={project} />
      ) : selection.length > 1 && canvas ? (
        <MultiCardProps canvas={canvas} selection={selection} project={project} />
      ) : (
        <>
          {canvas && key && <CanvasProps canvas={canvas} canvasKey={key} project={project} />}
          <ProjectProps project={project} />
        </>
      )}
    </aside>
  );
}

export { Library } from "./tree";
export { BottomPanel } from "./bottom";
export { EntityProps };
