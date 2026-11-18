import { flowCards, type Card, type Project } from "@visink/core";

export function projectCardLabels(project: Project) {
  const labels = { line: "Реплика", hub: "Хаб", condition: "Условие", jump: "Переход", flow: "Вложенность", ink: "Ink" };
  const describeCard = (card: Card) => {
    if (card.type === "condition") return `Условие: ${card.condition || "не задано"}`;
    const text = card.text || card.menuText;
    if (card.type === "line") {
      const speaker = project.entities.find((e) => e.id === card.speaker)?.name;
      return [speaker, text || labels.line].filter(Boolean).join(": ");
    }
    return text ? `${labels[card.type]}: ${text}` : labels[card.type];
  };
  const targets = new Map<string, string>();
  for (const canvas of Object.values(project.canvases)) {
    targets.set(canvas.id, canvas.title || canvas.id);
    const cards = flowCards(canvas).map(({ card }) => card);
    for (const card of cards) targets.set(`${canvas.id}.${card.id}`, describeCard(card));
    // Точки входа имеют тот же приоритет, что и при компиляции перехода.
    for (const card of cards) if (card.entry) {
      targets.set(`${canvas.id}.${card.entry}`, describeCard(card));
      targets.set(`${canvas.id}.entry_${card.entry}`, describeCard(card));
    }
  }
  return { describeCard, targets };
}

export function jumpDestination(targets: Map<string, string>, target?: string) {
  const address = target?.trim();
  return address ? targets.get(address) ?? "Цель не найдена" : "Цель не задана";
}
