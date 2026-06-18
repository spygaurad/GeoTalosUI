'use client';

import { useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
} from '@tanstack/react-table';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ChevronDown, Plus, Trash2, Palette } from 'lucide-react';
import { annotationSchemasApi } from '@/lib/api/annotation-schemas';
import { annotationClassesApi } from '@/lib/api/annotation-classes';
import { useClassHierarchy, type ClassRow } from '@/hooks/use-class-hierarchy';
import type { AnnotationClass } from '@/types/api';

interface Props {
  schemaId: string;
}

// ── Inline style editor shown inside the fill-color Popover ─────────────────
function StyleEditor({
  cls,
  schemaId,
  onSave,
}: {
  cls: AnnotationClass;
  schemaId: string;
  onSave: () => void;
}) {
  const current = cls.style?.definition as { fillColor?: string; strokeColor?: string; strokeWidth?: number; fillOpacity?: number } | undefined ?? {};
  const [fillColor, setFillColor] = useState<string>(current.fillColor ?? '#3b82f6');
  const [strokeColor, setStrokeColor] = useState<string>(current.strokeColor ?? '#1d4ed8');
  const [strokeWidth, setStrokeWidth] = useState<number>(current.strokeWidth ?? 2);
  const [fillOpacity, setFillOpacity] = useState<number>(current.fillOpacity ?? 0.5);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await annotationSchemasApi.updateClassStyle(schemaId, cls.id, {
        definition: { fillColor, strokeColor, strokeWidth, fillOpacity },
      });
      onSave();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ width: 240, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Preview */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
        <svg width="60" height="48" viewBox="0 0 60 48">
          <polygon
            points="30,4 56,44 4,44"
            fill={fillColor}
            fillOpacity={fillOpacity}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
          />
        </svg>
      </div>

      {/* Fill color */}
      <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280' }}>
        Fill Color
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <input
            type="color"
            value={fillColor}
            onChange={(e) => setFillColor(e.target.value)}
            style={{ width: 32, height: 28, padding: 2, border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}
          />
          <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{fillColor}</span>
        </div>
      </label>

      {/* Stroke color */}
      <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280' }}>
        Stroke Color
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <input
            type="color"
            value={strokeColor}
            onChange={(e) => setStrokeColor(e.target.value)}
            style={{ width: 32, height: 28, padding: 2, border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}
          />
          <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{strokeColor}</span>
        </div>
      </label>

      {/* Stroke width */}
      <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280' }}>
        Stroke Width: {strokeWidth}px
        <input
          type="range" min={0} max={10} step={0.5}
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(Number(e.target.value))}
          style={{ width: '100%', marginTop: 4 }}
        />
      </label>

      {/* Fill opacity */}
      <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280' }}>
        Fill Opacity: {Math.round(fillOpacity * 100)}%
        <input
          type="range" min={0} max={1} step={0.05}
          value={fillOpacity}
          onChange={(e) => setFillOpacity(Number(e.target.value))}
          style={{ width: '100%', marginTop: 4 }}
        />
      </label>

      <Button size="sm" onClick={handleSave} disabled={saving} className="mt-1">
        {saving ? 'Saving…' : 'Save Style'}
      </Button>
    </div>
  );
}

export function ClassTable({ schemaId }: Props) {
  const queryClient = useQueryClient();
  const [expandedRows, setExpandedRows] = useState(new Set<string>());

  const { data: classesData } = useQuery({
    queryKey: ['schema', schemaId, 'classes'],
    queryFn: () => annotationSchemasApi.getClasses(schemaId),
  });

  const flatClasses: AnnotationClass[] = classesData?.items ?? [];
  const hierarchicalData = useClassHierarchy(flatClasses);

  const visibleRows = hierarchicalData.filter(row => {
    if (row.depth === 0) return true;
    let parentId = row.parent_id;
    while (parentId) {
      if (!expandedRows.has(parentId)) return false;
      const parent = flatClasses.find(c => c.id === parentId);
      parentId = parent?.parent_id ?? null;
    }
    return true;
  });

  const createMutation = useMutation({
    mutationFn: ({ name, parent_id }: { name: string; parent_id?: string }) =>
      annotationSchemasApi.createClass(schemaId, { name, parent_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schema', schemaId, 'classes'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (classId: string) => annotationClassesApi.delete(classId),
    onMutate: async (classId) => {
      await queryClient.cancelQueries({ queryKey: ['schema', schemaId, 'classes'] });
      const previous = queryClient.getQueryData<{ items: AnnotationClass[] }>(['schema', schemaId, 'classes']);
      queryClient.setQueryData(['schema', schemaId, 'classes'], (old: { items: AnnotationClass[] } | undefined) => {
        if (!old?.items) return old;
        return { ...old, items: old.items.filter(cls => cls.id !== classId) };
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['schema', schemaId, 'classes'], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['schema', schemaId, 'classes'] });
    },
  });

  const columns: ColumnDef<ClassRow>[] = [
    {
      id: 'expander',
      size: 50,
      cell: ({ row }) => {
        const rowData = row.original;
        if (!rowData.hasChildren) return null;
        const isExpanded = expandedRows.has(rowData.id);
        return (
          <Button
            variant="ghost"
            size="sm"
            className={`h-8 w-8 p-0 ${isExpanded ? 'rotate-90' : ''}`}
            onClick={() => {
              setExpandedRows(prev => {
                const next = new Set(prev);
                if (isExpanded) next.delete(rowData.id); else next.add(rowData.id);
                return next;
              });
            }}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        );
      },
    },
    {
      accessorKey: 'name',
      header: 'Class Name',
      size: 300,
      cell: ({ getValue, row }) => {
        const rowData = row.original;
        return (
          <div
            className="font-medium truncate max-w-md"
            style={{ paddingLeft: `${rowData.depth * 20}px` }}
          >
            {getValue() as string}
          </div>
        );
      },
    },
    {
      id: 'style',
      header: 'Style',
      size: 160,
      cell: ({ row }) => {
        const cls = row.original as unknown as AnnotationClass;
        const def = cls.style?.definition;
        const fillColor = def?.fillColor ?? '#94a3b8';
        const strokeColor = def?.strokeColor ?? '#475569';
        const fillOpacity = def?.fillOpacity ?? 0.5;
        const strokeWidth = def?.strokeWidth ?? 2;

        return (
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="flex items-center gap-2 px-2 py-1 rounded border border-border hover:bg-muted transition-colors cursor-pointer"
                title="Edit style"
              >
                {/* Fill swatch */}
                <div
                  className="w-5 h-5 rounded border flex-shrink-0"
                  style={{
                    background: fillColor,
                    opacity: fillOpacity,
                    borderColor: strokeColor,
                    borderWidth: Math.max(1, strokeWidth / 2),
                  }}
                />
                <Palette className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-mono text-muted-foreground">{fillColor}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <StyleEditor
                cls={cls}
                schemaId={schemaId}
                onSave={() => queryClient.invalidateQueries({ queryKey: ['schema', schemaId, 'classes'] })}
              />
            </PopoverContent>
          </Popover>
        );
      },
    },
    {
      id: 'actions',
      size: 100,
      cell: ({ row }) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => createMutation.mutate({
              name: `New ${row.original.name} Subclass`,
              parent_id: row.original.id,
            })}
            title="Add subclass"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => deleteMutation.mutate(row.original.id)}
            className="text-destructive hover:bg-destructive/10"
            title="Delete class"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const table = useReactTable({
    data: visibleRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange',
  });

  return (
    <div className="space-y-4 w-full">
      <div className="rounded-md border bg-background shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map(headerGroup => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <TableHead key={header.id} style={{ width: header.getSize() }}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map(row => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map(cell => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  No classes found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="text-xs text-muted-foreground text-center">
        {flatClasses.length} total classes · {expandedRows.size} expanded
      </div>
    </div>
  );
}
