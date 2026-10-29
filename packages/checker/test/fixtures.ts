import type { Canvas, Card, Link, Project } from "@visink/core";
import { createCanvas, createCard, createProject } from "@visink/core";

function canvas(id: string, title: string, cards: Card[], links: [string, string, ("yes" | "no")?][]): Canvas {
  const c = createCanvas(id, title);
  c.cards = cards;
  c.start = cards[0].id;
  const order = new Map<string, number>();
  c.links = links.map(([from, to, port]): Link => {
    const n = order.get(from) ?? 0;
    order.set(from, n + 1);
    return { from, to, order: n, kind: "divert", ...(port ? { port } : {}) };
  });
  // раскладка по слоям: столбец = длина кратчайшего пути от первой карточки
  const depth = new Map<string, number>([[cards[0].id, 0]]);
  const queue = [cards[0].id];
  while (queue.length) {
    const id = queue.shift()!;
    for (const l of c.links) {
      if (l.from === id && !depth.has(l.to)) {
        depth.set(l.to, depth.get(id)! + 1);
        queue.push(l.to);
      }
    }
  }
  const rows = new Map<number, number>();
  for (const card of cards) {
    const d = depth.get(card.id) ?? 0;
    const row = rows.get(d) ?? 0;
    rows.set(d, row + 1);
    c.layout[card.id] = { x: d * 300, y: row * 180 };
  }
  return c;
}

/** Холст «Декан» из примера в ТЗ + второй холст со всеми типами карточек. */
export function demoProject(): Project {
  const p = createProject("Тёмная академия — демо");
  p.entities.push(
    { id: "ent_dean", kind: "character", name: "Декан Левенгаупт", inkName: "ДЕКАН", color: "#8a5cf6" },
    { id: "ent_advisor", kind: "character", name: "Научрук", inkName: "НАУЧРУК", color: "#10b981" },
  );
  p.variables.vars.push(
    { name: "thesis_changed", type: "bool", default: false, group: "Сюжет" },
    { name: "dean_trust", type: "int", default: 0, group: "Отношения" },
    { name: "logic", type: "int", default: 2, group: "Навыки" },
  );
  p.variables.lists.push({ name: "Clues", items: ["archive", "letter"], initial: [] });
  p.settings.start = "dean.first_meeting";

  const D = "ent_dean";
  const P = "ent_player";
  const dean = canvas(
    "dean",
    "Декан",
    [
      createCard("c1", "line", { speaker: D, text: "Садитесь.", entry: "first_meeting" }),
      createCard("c2", "line", { speaker: D, text: "Итак, ваша диссертация?" }),
      createCard("c3", "line", { speaker: P, text: "Почти готова.", menuText: "«Почти готова»." }),
      createCard("c4", "line", { speaker: P, text: "Я сменил тему.", menuText: "«Я сменил тему».", condition: "not thesis_changed", action: "thesis_changed = true" }),
      createCard("c5", "line", { speaker: P, text: "", menuText: "Промолчать.", action: "dean_trust -= 1" }),
      createCard("c6", "line", { speaker: D, text: "Посмотрим.", emotion: "cold" }),
      createCard("c7", "line", { speaker: D, text: "Молчание — тоже ответ.", stageDirection: "откидывается в кресле" }),
      createCard("c8", "jump", { target: "advisor.office" }),
    ],
    [
      ["c1", "c2"], ["c2", "c3"], ["c2", "c4"], ["c2", "c5"],
      ["c3", "c6"], ["c4", "c6"], ["c5", "c7"], ["c6", "c8"],
    ],
  );

  const A = "ent_advisor";
  const advisor = canvas(
    "advisor",
    "Кабинет научрука",
    [
      createCard("a1", "line", { speaker: A, entry: "office", text: "Ну что, был у декана? # не тег {не условие} [не выбор] // не комментарий -> не переход" }),
      createCard("a2", "hub"),
      createCard("a3", "line", { speaker: P, menuText: "Спросить про архив.", text: "Что в архиве?", repeat: "once" }),
      createCard("a4", "line", { speaker: P, menuText: "Спросить про письмо.", text: "Кто прислал письмо?", condition: "logic >= 3" }),
      createCard("a5", "line", { speaker: P, menuText: "Уйти.", text: "Мне пора.", repeat: "sticky" }),
      createCard("a6", "line", { speaker: A, text: "Туда пускают только с допуском.", action: "~ Clues += archive" }),
      createCard("a7", "line", { speaker: A, text: "Без подписи. Странно, правда?", action: "Clues += letter" }),
      createCard("a8", "condition", { condition: "dean_trust < 0" }),
      createCard("a9", "line", { speaker: A, text: "Декан на вас зол." }),
      createCard("a10", "ink", { text: "{~Удачи.|Иди уже.|Хватит.}" }),
      createCard("a11", "ink", { text: "-> END" }),
      createCard("a12", "line", { speaker: P, text: "", repeat: "fallback" }),
    ],
    [
      ["a1", "a2"],
      ["a2", "a3"], ["a2", "a4"], ["a2", "a5"], ["a2", "a12"],
      ["a3", "a6"], ["a4", "a7"], ["a6", "a2"], ["a7", "a2"],
      ["a5", "a8"], ["a12", "a8"], ["a8", "a9", "yes"], ["a8", "a10", "no"], ["a9", "a10"], ["a10", "a11"],
    ],
  );

  p.canvases.dean = dean;
  p.canvases.advisor = advisor;
  return p;
}
