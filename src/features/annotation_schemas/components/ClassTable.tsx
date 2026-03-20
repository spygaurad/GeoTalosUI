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
import { Badge } from '@/components/ui/badge';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { annotationSchemasApi } from '@/lib/api/annotation-schemas';
import { annotationClassesApi } from '@/lib/api/annotation-classes';
import { useClassHierarchy, type ClassRow } from '@/hooks/use-class-hierarchy';
import type { AnnotationClass } from '@/types/api';

interface Props {
  schemaId: string;
}

export function ClassTable({ schemaId }: Props) {
  const queryClient = useQueryClient();
  const [expandedRows, setExpandedRows] = useState(new Set<string>());

  // ✅ YOUR EXACT API: getClasses
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

    const updateStyleMutation = useMutation({
    mutationFn: ({ classId, color }: { classId: string; color: string }) =>
        annotationSchemasApi.updateClassStyle(schemaId, classId, {
        style: { definition: { fillColor: color } }
        }),
    
    onMutate: async ({ classId, color }) => {
        await queryClient.cancelQueries({ queryKey: ['schema', schemaId, 'classes'] });
        
        const previousClasses = queryClient.getQueryData<{ items: AnnotationClass[] }>(['schema', schemaId, 'classes']);
        
        queryClient.setQueryData(['schema', schemaId, 'classes'], (old: { items: AnnotationClass[] } | undefined) => {
        if (!old?.items) return old;
        return {
            ...old,
            items: old.items.map(cls => 
            cls.id === classId
                ? {
                    ...cls,
                    style: {
                    ...cls.style,
                    definition: {
                        ...cls.style?.definition,
                        fillColor: color
                    }
                    }
                }
                : cls
            )
        };
        });
        
        return { previousClasses };  // ✅ Return correct key
    },
    
    onError: (err, variables, context) => {  // ✅ context.previousClasses exists
        if (context?.previousClasses) {
        queryClient.setQueryData(['schema', schemaId, 'classes'], context.previousClasses);
        }
    },
    
    onSettled: () => {
        queryClient.invalidateQueries({ queryKey: ['schema', schemaId, 'classes'] });
    },
    });

  // ✅ YOUR EXACT API: createClass (schema-scoped)
  const createMutation = useMutation({
    mutationFn: ({ name, parent_id }: { name: string; parent_id?: string }) =>
      annotationSchemasApi.createClass(schemaId, { name, parent_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schema', schemaId, 'classes'] });
    },
  });

    // annotationClassesApi.delete (standalone)
    const deleteMutation = useMutation({
    mutationFn: (classId: string) => annotationClassesApi.delete(classId),
    
    onMutate: async (classId) => {
        await queryClient.cancelQueries({ queryKey: ['schema', schemaId, 'classes'] });
        const previousClasses = queryClient.getQueryData<{ items: AnnotationClass[] }>(['schema', schemaId, 'classes']);
        
        queryClient.setQueryData(['schema', schemaId, 'classes'], (old: { items: AnnotationClass[] } | undefined) => {
        if (!old?.items) return old;
        return {
            ...old,
            items: old.items.filter(cls => cls.id !== classId)
        };
        });
        
        return { previousClasses };  // ✅ Return correct key
    },
    
    onError: (err, variables, context) => {  // ✅ Matches onMutate return
        if (context?.previousClasses) {
        queryClient.setQueryData(['schema', schemaId, 'classes'], context.previousClasses);
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
                const newSet = new Set(prev);
                if (isExpanded) newSet.delete(rowData.id);
                else newSet.add(rowData.id);
                return newSet;
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
        id: 'stylePreview',
        header: 'Style Preview',
        size: 140,
        cell: ({ row }) => {
            const style = row.original.style?.definition;
            const fillColor = style?.fillColor ?? '#64748b';
            const strokeColor = style?.strokeColor ?? '#374151';
            
            return (
            <div className="flex items-center gap-2 p-1 rounded bg-muted">
                {/* Fill color swatch */}
                <div 
                className="w-6 h-6 rounded-full border" 
                style={{ backgroundColor: fillColor }} 
                title={fillColor}
                />
                {/* Symbol placeholder (no emoji) */}
                <div className="w-4 h-4 bg-current border rounded-sm flex-shrink-0" title="Symbol"/>
                {/* Stroke preview */}
                <div 
                className="w-8 h-1 rounded-full bg-muted-foreground/20 border" 
                style={{ borderColor: strokeColor }} 
                title={strokeColor}
                />
            </div>
            );
        },
    },
    {
        id: 'fillColor',
        header: 'Fill',
        size: 100,
        cell: ({ row }) => {
            const color = row.original.style?.definition?.fillColor ?? '#64748b';
            return (
            <Popover>
                <PopoverTrigger asChild>
                <div 
                    className="w-10 h-10 rounded-lg border-2 border-border cursor-pointer hover:ring-2 hover:ring-primary transition-all"
                    style={{ backgroundColor: color }}
                    title={color}
                />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-3">
                <input
                    type="color"
                    defaultValue={color}
                    className="w-52 h-52 p-1 border rounded-lg cursor-pointer block mx-auto mb-2"
                    onChange={(e) => {
                    updateStyleMutation.mutate({
                        classId: row.original.id,
                        color: e.target.value,
                    });
                    }}
                />
                <div className="text-xs text-center text-muted-foreground font-mono">
                    {color}
                </div>
                </PopoverContent>
            </Popover>
            );
        },
    },
    {
      id: 'actions',
      size: 120,
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
        {flatClasses.length} total classes • {expandedRows.size} expanded
      </div>
    </div>
  );
}