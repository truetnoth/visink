import { useState } from "react";
import { namespaceError, namespaceName, type Project } from "@visink/core";
import { renameNamespace } from "./namespaceOps";
import { useStore } from "./store";

export function NamespaceField({ project, id }: { project: Project; id: string }) {
  const name = namespaceName(project, id);
  const [draft, setDraft] = useState(name);
  const [previous, setPrevious] = useState(name);
  if (previous !== name) { setPrevious(name); setDraft(name); }
  const error = namespaceError(project, draft, id);
  const apply = () => {
    if (!error && draft !== name) useStore.getState().edit((p) => renameNamespace(p, id, draft));
  };
  return <label className="field">
    <span className="field-label">Техническое имя</span>
    <input aria-label="Техническое имя" className="mono" value={draft} spellCheck={false} autoCapitalize="off" autoCorrect="off" aria-invalid={!!error}
      onChange={(e) => setDraft(e.target.value)} onBlur={apply}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } if (e.key === "Escape") setDraft(name); }} />
    <span className={`field-hint ${error ? "bad" : ""}`}>{error ?? ``}</span>
  </label>;
}
