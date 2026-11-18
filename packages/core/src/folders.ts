import type { Project, FolderSection, ProjectFolder } from './model';

/** Convert legacy free-text groups once; folders never affect Ink file paths. */
export function migrateFolders(project: Project) {
  const folders = project.settings.folders ??= [];
  const migrate = (items: { group?: string; folderId?: string }[], section: FolderSection) => {
    for (const item of items) {
      if (!item.group) continue;
      if (!item.folderId) {
        let parent: string | undefined;
        for (const name of item.group.split('/').map((s) => s.trim()).filter(Boolean)) {
          let folder: ProjectFolder | undefined = folders.find((f) => f.section === section && f.parent === parent && f.name === name);
          if (!folder) {
            let n = 1; while (folders.some((f) => f.id === `folder_${n}`)) n++;
            folder = { id: `folder_${n}`, section, name, ...(parent ? { parent } : {}) }; folders.push(folder);
          }
          parent = folder.id;
        }
        item.folderId = parent;
      }
      delete item.group;
    }
  };
  migrate(Object.values(project.canvases), 'files');
  migrate(project.entities, 'entities');
  migrate([...project.variables.vars, ...project.variables.functions, ...project.variables.lists].filter((v) => !v.owner), 'variables');
}
