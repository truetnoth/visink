import { canvasLocations, isBoundaryCard, prepareProject, type Card, type Project } from "@visink/core";

export function projectCardLabels(project: Project) {
  project = prepareProject(structuredClone(project));
  const labels = { line: "Реплика", hub: "Хаб", condition: "Условие", jump: "Переход", flow: "Вложенность", entry: "Вход", exit: "Выход", ink: "Ink" };
  const describeCard = (card: Card) => {
    if (card.type === "condition") return `Условие: ${card.condition || "не задано"}`;
    const text = card.text || card.menuText;
    if (card.type === "line") {
      const speaker = project.entities.find((e) => e.id === card.speaker)?.name;
      return [speaker, text || labels.line].filter(Boolean).join(": ");
    }
    if (card.type === "flow") return text || labels.flow;
    return text ? `${labels[card.type]}: ${text}` : labels[card.type];
  };
  const targets = new Map<string, string>();
  for (const { canvas } of canvasLocations(project)) {
    targets.set(canvas.id, canvas.title || canvas.id);
    if (canvas.legacyId === canvas.id) targets.set(canvas.legacyId, canvas.title || canvas.id);
    const addresses = [canvas.id, ...(canvas.legacyId ? [canvas.legacyId] : [])];
    for (const card of canvas.cards) {
      if (isBoundaryCard(card)) continue;
      for (const address of addresses) {
        targets.set(`${address}.${card.id}`, describeCard(card));
        if (card.entry) {
          targets.set(`${address}.${card.entry}`, describeCard(card));
          targets.set(`${address}.entry_${card.entry}`, describeCard(card));
        }
      }
    }
  }
  return { describeCard, targets };
}

export function jumpDestination(targets: Map<string, string>, target?: string) {
  const address = target?.trim();
  return address ? targets.get(address) ?? "Цель не найдена" : "Цель не задана";
}
