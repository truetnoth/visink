// Модель проекта Visink. Источник правды — эти структуры, ink — результат сборки.

export type CardType =
  | "line" // реплика
  | "hub" // стежок без текста, цикл расспросов
  | "condition" // да / нет
  | "jump" // переход на другой холст
  | "ink"; // чистый ink

export type Repeat = "once" | "sticky" | "fallback";
export type TextStatus = "draft" | "review" | "final";

export interface Card {
  id: string;
  type: CardType;
  /** имя точки входа: игра может начать отсюда, путь ink "холст.entry_имя" */
  entry?: string;
  speaker?: string;
  text?: string;
  menuText?: string;
  stageDirection?: string;
  emotion?: string;
  /** ink-выражение, проверяется на входе в карточку */
  condition?: string;
  /** ink-логика, строки `~ ...` (тильду можно не писать) */
  action?: string;
  repeat?: Repeat;
  tags?: Record<string, string>;
  status?: TextStatus;
  note?: string;
  /** jump: "canvas", "canvas.entry_name" или "canvas.cardId" */
  target?: string;
}

export type LinkKind = "divert";

export interface Link {
  from: string;
  /** id карточки на этом холсте */
  to: string;
  order: number;
  kind: LinkKind;
  /** condition-карточка: какой выход — "yes" | "no" */
  port?: "yes" | "no";
  /** ink-выражение: по стрелке можно пройти, только если оно истинно */
  condition?: string;
  /** ink-логика при переходе по стрелке, строки `~ ...` */
  action?: string;
}

export interface Point {
  x: number;
  y: number;
  /** размер карточки, если его поменяли вручную */
  w?: number;
  h?: number;
}

export interface Note {
  id: string;
  text: string;
  x: number;
  y: number;
}

export interface Group {
  title: string;
  cards: string[];
}

export interface Entry {
  name: string;
  card: string;
}

export interface Canvas {
  id: string;
  title: string;
  /** id карточки, с которой начинается файл (узел ink) */
  start?: string;
  owner?: string;
  entries: Entry[];
  cards: Card[];
  links: Link[];
  layout: Record<string, Point>;
  groups: Group[];
  notes: Note[];
  /** id удалённых карточек: никогда не переиспользуются */
  graveyard: string[];
}

export type EntityKind = "character" | "item" | "location" | "skill";

export interface Entity {
  id: string;
  kind: EntityKind;
  name: string;
  /** имя спикера в строке ink: «ДЕКАН: текст» */
  inkName: string;
  color: string;
  portrait?: string;
  isPlayer?: boolean;
  props?: Record<string, string>;
}

export type VarType = "int" | "float" | "bool" | "string";

export interface Variable {
  name: string;
  type: VarType;
  default: number | boolean | string;
  group?: string;
}

export interface InkListDef {
  name: string;
  items: string[];
  initial: string[];
}

/** Функция ink: `=== function name(params) ===` с телом. */
export interface InkFunction {
  name: string;
  params: string[];
  /** тело функции — ink как есть, обычно строки `~ ...` и `~ return ...` */
  body: string;
  group?: string;
  description?: string;
  /** функцию реализует игра (EXTERNAL); тело — запасной вариант для Inky и проверок */
  external?: boolean;
}

export interface Variables {
  vars: Variable[];
  lists: InkListDef[];
  functions: InkFunction[];
}

export interface ProjectSettings {
  name: string;
  /** папка сборки относительно папки проекта */
  buildDir: string;
  /** "canvas" или "canvas.entry" — куда переходит main.ink */
  start?: string;
  languages: string[];
}

export interface Project {
  settings: ProjectSettings;
  entities: Entity[];
  variables: Variables;
  /** ключ — id холста */
  canvases: Record<string, Canvas>;
}
