'use client';

import { useMemo } from 'react';
import type { AnnotationClass } from '@/types/api';

export interface ClassRow extends AnnotationClass {
  depth: number;
  hasChildren: boolean;
}

export function useClassHierarchy(classes: AnnotationClass[]) {
  return useMemo(() => {
    // Build lookup map for O(1) parent lookups
    const classMap = new Map(classes.map(c => [c.id, c]));
    
    return classes.map(cls => {
      const row: ClassRow = { ...cls, depth: 0, hasChildren: false };
      
      // Compute depth (simple while loop)
      let depth = 0;
      let parentId = cls.parent_id;
      while (parentId && classMap.has(parentId)) {
        depth++;
        const parent = classMap.get(parentId)!;
        parentId = parent.parent_id;
      }
      row.depth = depth;
      
      // Check if has children (single pass)
      row.hasChildren = classes.some(c => c.parent_id === cls.id);
      
      return row;
    }).sort((a, b) => {
      // Roots first, then stable sort by ID
      return a.depth - b.depth || a.id.localeCompare(b.id);
    });
  }, [classes]);
}