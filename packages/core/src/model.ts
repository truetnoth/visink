// Модель проекта Visink. Источник правды — эти структуры, ink — результат сборки.

export type CardType =
  | "line" // реплика
  | "hub" // стежок без текста, цикл расспросов
  | "condition" // да / нет
  | "jump" // переход на другой холст
  | "flow" // именованная вложенность: карточка, папка в дереве и отдельный knot Ink
  | "entry" // единственный явный вход холста
  | "exit" // единственный выход; у вложенности продолжает карточку-владельца
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
  /** пользовательский цвет подходящих типов карточек */
  color?: string;
  note?: string;
  /** сохраняемое описание карточки-вложенности */
  description?: string;
  /** организационная папка для карточки-вложенности верхнего уровня */
  folderId?: string;
  /** jump: "canvas", "canvas.entry_name" или "canvas.cardId" */
  target?: string;
  /** содержимое карточки-контейнера; экспортируется как отдельный knot Ink */
  flow?: Canvas;
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
  /** одноразовая миграция: прежний прямой старт не превращается в меню выбора */
  direct?: boolean;
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
  color?: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
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
  /** папка в списке файлов; на сборку не влияет */
  group?: string;
  folderId?: string;
  /** прежний корневой адрес для тегов строк и совместимых stitch/entry */
  legacyId?: string;
  /** @deprecated источник для миграции; начало задаёт связь из карточки «Вход» */
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
  /** Имя пространства переменных; старые проекты используют id. */
  technicalName?: string;
  /** Legacy classification; all entities can be speakers. */
  kind: EntityKind;
  description?: string;
  name: string;
  /** имя спикера в строке ink: «ДЕКАН: текст» */
  inkName: string;
  color: string;
  portrait?: string;
  isPlayer?: boolean;
  /** папка в списке персонажей */
  group?: string;
  folderId?: string;
  props?: Record<string, string>;
}

export type VarType = "int" | "float" | "bool" | "string";

export interface Variable {
  name: string;
  type: VarType;
  default: number | boolean | string;
  group?: string;
  folderId?: string;
  description?: string;
  /** стабильный id сущности или набора; пусто — глобальная переменная */
  owner?: string;
}

export interface InkListDef {
  name: string;
  items: string[];
  initial: string[];
  group?: string;
  folderId?: string;
  description?: string;
  owner?: string;
}

/** Функция ink: `=== function name(params) ===` с телом. */
export interface InkFunction {
  name: string;
  params: string[];
  /** тело функции — ink как есть, обычно строки `~ ...` и `~ return ...` */
  body: string;
  group?: string;
  folderId?: string;
  description?: string;
  /** id персонажа; пусто — глобальная функция */
  owner?: string;
  /** функцию реализует игра (EXTERNAL); тело — запасной вариант для Inky и проверок */
  external?: boolean;
}

export interface VariableSet {
  id: string;
  name: string;
  description?: string;
}

export interface Variables {
  sets?: VariableSet[];
  vars: Variable[];
  lists: InkListDef[];
  functions: InkFunction[];
}

export type FolderSection = "files" | "entities" | "variables";
export interface ProjectFolder {
  id: string;
  name: string;
  section: FolderSection;
  parent?: string;
}

export interface ProjectSettings {
  folders?: ProjectFolder[];
  formatVersion?: number;
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
