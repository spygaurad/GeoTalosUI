/**
 * Module registry for the modular MapManager architecture.
 *
 * Modules register themselves here. The core system uses this registry to:
 * 1. Resolve initialization order (via topological sort on dependencies)
 * 2. Compose store slices
 * 3. Compose sync hooks
 * 4. Merge manager extensions
 * 5. Register layer factories and feature types
 */

import type { MapModule } from './types';

// ── Registry storage ────────────────────────────────────────────────────────

const modules = new Map<string, MapModule>();

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Register a map module. Called once per module at import time.
 * Throws if a module with the same id is already registered.
 */
export function registerMapModule(mod: MapModule): void {
  if (modules.has(mod.id)) {
    throw new Error(`[MapRegistry] Module '${mod.id}' already registered`);
  }
  modules.set(mod.id, mod);
}

/**
 * Get a specific module by id.
 */
export function getMapModule(id: string): MapModule | undefined {
  return modules.get(id);
}

/**
 * Get all registered modules in dependency-resolved order.
 * Modules with no dependencies come first. Cyclic dependencies throw.
 */
export function getMapModules(): MapModule[] {
  return topologicalSort([...modules.values()]);
}

/**
 * Get all registered module ids.
 */
export function getRegisteredModuleIds(): string[] {
  return [...modules.keys()];
}

/**
 * Clear all registrations (useful for testing).
 */
export function clearRegistry(): void {
  modules.clear();
}

// ── Topological sort ────────────────────────────────────────────────────────

function topologicalSort(mods: MapModule[]): MapModule[] {
  const sorted: MapModule[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const modMap = new Map<string, MapModule>();
  for (const mod of mods) {
    modMap.set(mod.id, mod);
  }

  function visit(mod: MapModule): void {
    if (visited.has(mod.id)) return;
    if (visiting.has(mod.id)) {
      throw new Error(
        `[MapRegistry] Cyclic dependency detected involving module '${mod.id}'`,
      );
    }

    visiting.add(mod.id);

    for (const depId of mod.dependencies ?? []) {
      const dep = modMap.get(depId);
      if (dep) {
        visit(dep);
      }
      // If dependency not registered, skip silently (might be optional)
    }

    visiting.delete(mod.id);
    visited.add(mod.id);
    sorted.push(mod);
  }

  for (const mod of mods) {
    visit(mod);
  }

  return sorted;
}
