import { isAbsolute, join, normalize } from "node:path";
import { wildcard } from "./wildcard.ts";

export interface PermissionRule {
  action: string;
  resource: string;
  effect: "allow" | "deny" | "ask";
}

export interface EditMode {
  /** The agent's edit tool is denied (not just asked) for ordinary project files. */
  readOnly: boolean;
  /** Edit paths the rules still allow while read-only (plan mode's plan folder). */
  editable: string[];
}

const PROBE = ".auto-mode-probe";

function lastMatch(rules: readonly PermissionRule[], action: string, resource: string): PermissionRule | undefined {
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i]!;
    // A catch-all allow (`"*": "allow"` in the user's config, appended after the agent's own rules) is about
    // not being prompted, not about unlocking edits for a read-only agent such as plan.
    if (rule.action === "*" && rule.effect === "allow") continue;
    if (wildcard(action, rule.action) && wildcard(resource, rule.resource)) return rule;
  }
  return undefined;
}

/**
 * Whether these rules (agent's, then the session's; last match wins) deny the edit tool for a file in the
 * project. Unlike OpenCode, catch-all `*` allows are skipped: with `"*": "allow"` in the config, OpenCode
 * lets plan mode edit and only the prompt holds it back.
 */
export function editMode(rules: readonly PermissionRule[], directory: string | undefined): EditMode {
  const probes = [PROBE, directory ? `${directory.replace(/\/+$/, "")}/${PROBE}` : undefined].filter(
    (probe): probe is string => probe !== undefined,
  );
  const readOnly = probes.some((probe) => lastMatch(rules, "edit", probe)?.effect === "deny");
  if (!readOnly) return { readOnly, editable: [] };
  const editable = rules
    .filter((rule) => rule.effect === "allow" && rule.resource !== "*" && wildcard("edit", rule.action))
    .map((rule) => rule.resource);
  return { readOnly, editable: [...new Set(editable)] };
}

/** A read-only agent's edit tool call: allowed only when every file is in one of its editable paths. */
export function editableByAgent(mode: EditMode, resources: readonly string[], directory: string | undefined): boolean {
  if (resources.length === 0) return false;
  return resources.every((resource) => {
    const absolute = isAbsolute(resource) || !directory ? resource : join(directory, resource);
    const path = normalize(absolute);
    return mode.editable.some((pattern) => wildcard(path, pattern));
  });
}

/** Keeps only well-formed rules from an API payload. */
export function permissionRules(value: unknown): PermissionRule[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (rule): rule is PermissionRule =>
      !!rule &&
      typeof rule.action === "string" &&
      typeof rule.resource === "string" &&
      (rule.effect === "allow" || rule.effect === "deny" || rule.effect === "ask"),
  );
}
