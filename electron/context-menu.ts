import type { ContextMenuParams, MenuItemConstructorOptions } from "electron";

/**
 * What a right-click shows, as in other Mac apps: the editing commands in a text field, Copy on
 * selected text, and nothing elsewhere.
 */
export function contextMenuTemplate(
  params: Pick<ContextMenuParams, "isEditable" | "selectionText" | "editFlags">,
): MenuItemConstructorOptions[] {
  if (params.isEditable) {
    return [
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { type: "separator" },
      { role: "selectAll", enabled: params.editFlags.canSelectAll },
    ];
  }
  if (params.selectionText.trim() !== "") return [{ role: "copy" }];
  return [];
}
