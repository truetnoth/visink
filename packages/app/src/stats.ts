import { isBoundaryCard, isPlayerCard, type Canvas, type Project } from "@visink/core";

function words(text: string | undefined) {
  return text?.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}

export function projectStats(project: Project) {
  const stats = {
    words: 0,
    elements: 0,
    lines: 0,
    playerOptions: 0,
    hubs: 0,
    conditions: 0,
    notes: 0,
    jumps: 0,
    inkCards: 0,
    flows: 0,
    links: 0,
    groups: 0,
    entities: project.entities.length,
    variables: project.variables.vars.length + project.variables.lists.length,
    functions: project.variables.functions.length,
    sets: project.variables.sets?.length ?? 0,
  };
  const visit = (canvas: Canvas) => {
    const cards = canvas.cards.filter((card) => !isBoundaryCard(card));
    stats.elements += cards.length + canvas.notes.length;
    stats.notes += canvas.notes.length;
    stats.groups += canvas.groups.length;
    stats.words += canvas.notes.reduce((sum, note) => sum + words(note.text), 0);
    const ordinary = new Set(cards.map((card) => card.id));
    stats.links += canvas.links.filter((link) => ordinary.has(link.from) && ordinary.has(link.to)).length;
    for (const card of cards) {
      if (card.type === "line") stats.lines++;
      if (isPlayerCard(project, card)) stats.playerOptions++;
      if (card.type === "hub") stats.hubs++;
      if (card.type === "condition") stats.conditions++;
      if (card.type === "jump") stats.jumps++;
      if (card.type === "ink") stats.inkCards++;
      if (card.flow) stats.flows++;
      if (card.type === "line") stats.words += words(card.text) + words(card.menuText) + words(card.stageDirection);
      if (card.flow) stats.words += words(card.description);
      if (card.flow) visit(card.flow);
    }
  };
  Object.values(project.canvases).forEach(visit);
  return stats;
}
