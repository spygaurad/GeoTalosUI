'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Upload, FileJson, X } from 'lucide-react';

import { annotationSchemasApi } from '@/lib/api/annotation-schemas';
import {
  annotationSetsApi,
  type GeoJSONFeatureCollection,
} from '@/lib/api/annotation-sets';
import { datasetsApi } from '@/lib/api/datasets';
import { qk } from '@/lib/query-keys';

const BROWN = '#8c6d2c';
const BROWN_HOVER = '#7e6228';
const CLASS_PROPERTY = 'class_id';

// Header names auto-detected for CSV geometry (mirrors the backend defaults).
const WKT_CANDIDATES = ['geometry_wkt', 'wkt', 'geometry', 'geom'];
const LON_CANDIDATES = ['longitude', 'lon', 'lng', 'long', 'x'];
const LAT_CANDIDATES = ['latitude', 'lat', 'y'];

function parseCsvHeader(text: string): string[] {
  const line = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim()).filter(Boolean);
}

function pickColumn(header: string[], candidates: string[]): string {
  const byLower = new Map(header.map((h) => [h.toLowerCase(), h]));
  for (const c of candidates) {
    const hit = byLower.get(c);
    if (hit) return hit;
  }
  return '';
}

interface CsvFile {
  text: string;
  header: string[];
  rows: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the new set's id and the import job_id once the 202 returns. */
  onCreated?: (setId: string, jobId: string) => void;
}

export function ImportSetDrawer({ open, onClose, onCreated }: Props) {
  const { orgId } = useAuth();
  const qc = useQueryClient();

  const [schemaId, setSchemaId] = useState('');
  const [datasetId, setDatasetId] = useState('');
  const [itemId, setItemId] = useState('');
  const [setName, setSetName] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<GeoJSONFeatureCollection | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [csv, setCsv] = useState<CsvFile | null>(null);
  const [wktColumn, setWktColumn] = useState('');
  const [lonColumn, setLonColumn] = useState('');
  const [latColumn, setLatColumn] = useState('');

  const schemasQ = useQuery({
    queryKey: qk.annotationSchemas.list(),
    queryFn: () => annotationSchemasApi.list(100, 0),
    enabled: !!orgId && open,
  });
  const classesQ = useQuery({
    queryKey: qk.annotationSchemas.classes(schemaId),
    queryFn: () => annotationSchemasApi.getClasses(schemaId),
    enabled: !!schemaId,
  });
  const datasetsQ = useQuery({
    queryKey: qk.datasets.list(),
    queryFn: () => datasetsApi.list({ page_size: 100 }),
    enabled: !!orgId && open,
  });
  const itemsQ = useQuery({
    queryKey: qk.datasets.items(datasetId),
    queryFn: () => datasetsApi.listItems(datasetId, { page_size: 200 }),
    enabled: !!datasetId,
  });
  const existingSetsQ = useQuery({
    queryKey: ['annotation-sets', 'by-item', datasetId, itemId],
    queryFn: () => annotationSetsApi.listByOrg({ datasetId, stacItemId: itemId }),
    enabled: !!datasetId && !!itemId,
  });
  const existingCount = existingSetsQ.data?.items?.length ?? 0;
  const classes = classesQ.data?.items ?? [];

  const onFileChange = (f: File | null) => {
    setFile(f);
    setParsed(null);
    setParseError(null);
    setCsv(null);
    if (!f) return;
    if (f.name.toLowerCase().endsWith('.csv')) {
      const csvReader = new FileReader();
      csvReader.onload = () => {
        const text = String(csvReader.result ?? '');
        const header = parseCsvHeader(text);
        if (header.length === 0) {
          setParseError('CSV has no header row');
          return;
        }
        const wkt = pickColumn(header, WKT_CANDIDATES);
        const lon = pickColumn(header, LON_CANDIDATES);
        const lat = pickColumn(header, LAT_CANDIDATES);
        if (!wkt && !(lon && lat)) {
          setParseError('CSV needs a WKT column (e.g. geometry_wkt) or longitude and latitude columns');
        }
        setWktColumn(wkt);
        setLonColumn(wkt ? '' : lon);
        setLatColumn(wkt ? '' : lat);
        const rows = text.split(/\r?\n/).filter((l) => l.trim()).length - 1;
        setCsv({ text, header, rows: Math.max(rows, 0) });
      };
      csvReader.readAsText(f);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = String(reader.result ?? '')
          .replace(/[\u201C\u201D]/g, '"')
          .replace(/[\u2018\u2019]/g, "'");
        const gj = JSON.parse(raw);
        if (gj?.type !== 'FeatureCollection' || !Array.isArray(gj.features)) {
          setParseError('Not a valid GeoJSON FeatureCollection');
          return;
        }
        setParsed(gj as GeoJSONFeatureCollection);
      } catch (e) {
        setParseError(e instanceof Error ? e.message : 'Parse error');
      }
    };
    reader.readAsText(f);
  };

  const mappedPreview = useMemo(() => {
    if (!parsed || classes.length === 0) return null;
    const byName = new Map(classes.map((c) => [c.name.trim().toLowerCase(), c.id]));
    let mapped = 0;
    let unmapped = 0;
    const features = parsed.features.map((f) => {
      const props = { ...(f.properties ?? {}) };
      const rawName = (props.class ?? props.className ?? props.label) as string | undefined;
      if (rawName && byName.has(String(rawName).trim().toLowerCase())) {
        props[CLASS_PROPERTY] = byName.get(String(rawName).trim().toLowerCase())!;
        mapped++;
      } else if (props[CLASS_PROPERTY]) {
        mapped++;
      } else {
        unmapped++;
      }
      return { ...f, properties: props };
    });
    return { fc: { ...parsed, features } as GeoJSONFeatureCollection, mapped, unmapped };
  }, [parsed, classes]);

  const reset = () => {
    setSchemaId('');
    setDatasetId('');
    setItemId('');
    setSetName('');
    setDescription('');
    setFile(null);
    setParsed(null);
    setParseError(null);
    setCsv(null);
    setWktColumn('');
    setLonColumn('');
    setLatColumn('');
  };

  const csvGeometryReady = !!csv && (!!wktColumn || (!!lonColumn && !!latColumn));

  const createAndImport = useMutation({
    mutationFn: async () => {
      if (!schemaId) throw new Error('Select a schema');
      if (!setName.trim()) throw new Error('Enter a name');
      if (!parsed && !csvGeometryReady) throw new Error('Upload a GeoJSON or CSV file');
      const created = await annotationSetsApi.createStandalone({
        name: setName.trim(),
        description: description.trim() || null,
        schema_id: schemaId,
        dataset_id: datasetId || null,
        stac_item_id: itemId || null,
      });
      if (csv) {
        // Classes are matched server-side from a class_id or class_name column.
        const res = await annotationSetsApi.importCSV(created.id, {
          csv_text: csv.text,
          filename: file?.name,
          wkt_column: wktColumn || null,
          lon_column: wktColumn ? null : lonColumn || null,
          lat_column: wktColumn ? null : latColumn || null,
        });
        return { set: created, job: res };
      }
      const fc = mappedPreview?.fc ?? parsed!;
      const res = await annotationSetsApi.importGeoJSON(created.id, {
        geojson: fc,
        filename: file?.name,
        class_property: CLASS_PROPERTY,
      });
      return { set: created, job: res };
    },
    onSuccess: ({ set, job }) => {
      toast.success(`Import queued for "${set.name}"`);
      qc.invalidateQueries({ queryKey: ['annotation-sets'] });
      onCreated?.(set.id, job.job_id);
      reset();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Import failed'),
  });

  const copy = (txt: string) => {
    navigator.clipboard.writeText(txt);
    toast.success('Copied');
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-black/40"
        onClick={() => !createAndImport.isPending && onClose()}
      />
      <div className="w-full max-w-3xl bg-white shadow-2xl flex flex-col h-full overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary-100">
          <div>
            <h2 className="text-lg font-bold text-[#2a251a]">New Annotation Set</h2>
            <p className="text-xs text-neutral-600 mt-0.5">
              Each GeoJSON feature or CSV row becomes one annotation in this set.
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-neutral-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
          <section className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-neutral-700 mb-1">
                Schema <span className="text-red-500">*</span>
              </label>
              <select
                value={schemaId}
                onChange={(e) => setSchemaId(e.target.value)}
                className="w-full border border-neutral-300 rounded-md h-9 px-2 text-sm bg-white"
              >
                <option value="">— Select schema —</option>
                {schemasQ.data?.items.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Dataset (optional)
                </label>
                <select
                  value={datasetId}
                  onChange={(e) => {
                    setDatasetId(e.target.value);
                    setItemId('');
                  }}
                  className="w-full border border-neutral-300 rounded-md h-9 px-2 text-sm bg-white"
                >
                  <option value="">— None —</option>
                  {datasetsQ.data?.items.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Dataset item (optional)
                </label>
                <select
                  value={itemId}
                  onChange={(e) => setItemId(e.target.value)}
                  disabled={!datasetId}
                  className="w-full border border-neutral-300 rounded-md h-9 px-2 text-sm bg-white disabled:bg-neutral-100"
                >
                  <option value="">— None —</option>
                  {itemsQ.data?.items.map((it) => (
                    <option key={it.id} value={it.stac_item_id}>
                      {it.filename || it.stac_item_id}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-700 mb-1">
                Set name <span className="text-red-500">*</span>
              </label>
              <input
                value={setName}
                onChange={(e) => setSetName(e.target.value)}
                placeholder="e.g. AcumulacionAaron2B classified"
                className="w-full border border-neutral-300 rounded-md h-9 px-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-700 mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full border border-neutral-300 rounded-md px-2 py-1 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-700 mb-1">
                GeoJSON or CSV file <span className="text-red-500">*</span>
              </label>
              <label
                className="flex items-center gap-2 border-2 border-dashed border-primary-100 rounded-md px-4 py-6 cursor-pointer hover:bg-primary-50"
                style={{ color: BROWN }}
              >
                <FileJson size={18} />
                <span className="text-sm">
                  {file ? file.name : 'Click to select a .geojson or .csv file'}
                </span>
                <input
                  type="file"
                  accept=".geojson,.json,.csv,application/geo+json,application/json,text/csv"
                  className="hidden"
                  onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
                />
              </label>
              {parseError && <p className="text-xs text-red-600 mt-1">{parseError}</p>}
              {csv && (
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-neutral-600">{csv.rows} rows found</p>
                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1">
                      Geometry (WKT) column
                    </label>
                    <select
                      value={wktColumn}
                      onChange={(e) => setWktColumn(e.target.value)}
                      className="w-full border border-neutral-300 rounded-md h-9 px-2 text-sm bg-white"
                    >
                      <option value="">— Use longitude / latitude columns —</option>
                      {csv.header.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                  {!wktColumn && (
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: 'Longitude column', value: lonColumn, set: setLonColumn },
                        { label: 'Latitude column', value: latColumn, set: setLatColumn },
                      ].map((field) => (
                        <div key={field.label}>
                          <label className="block text-xs font-semibold text-neutral-700 mb-1">
                            {field.label}
                          </label>
                          <select
                            value={field.value}
                            onChange={(e) => field.set(e.target.value)}
                            className="w-full border border-neutral-300 rounded-md h-9 px-2 text-sm bg-white"
                          >
                            <option value="">— Select column —</option>
                            {csv.header.map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {parsed && (
                <p className="text-xs text-neutral-600 mt-1">
                  {parsed.features.length} features parsed
                  {mappedPreview &&
                    ` · mapped: ${mappedPreview.mapped} · unmapped: ${mappedPreview.unmapped}`}
                </p>
              )}
            </div>

            {existingCount > 0 && (
              <div className="text-xs text-neutral-600 bg-primary-50 border border-primary-100 rounded-md px-3 py-2">
                This dataset item already has {existingCount} annotation set
                {existingCount === 1 ? '' : 's'}. A new set will be created alongside them.
              </div>
            )}
          </section>

          <aside className="rounded-lg border border-primary-100 bg-primary-50/50 p-4 h-fit">
            <h3 className="font-semibold text-sm text-[#2a251a] mb-1">Class IDs</h3>
            <p className="text-[11px] text-neutral-600 mb-3">
              Copy these into your GeoJSON or CSV as <code>class_id</code> to bypass
              auto-mapping. CSV rows can also use a <code>class_name</code> column.
            </p>
            {!schemaId ? (
              <p className="text-xs text-neutral-500">Select a schema to see classes.</p>
            ) : classesQ.isLoading ? (
              <p className="text-xs text-neutral-500">Loading…</p>
            ) : classes.length === 0 ? (
              <p className="text-xs text-neutral-500">No classes in this schema.</p>
            ) : (
              <ul className="space-y-1 max-h-[420px] overflow-auto">
                {classes.map((c) => (
                  <li
                    key={c.id}
                    className="bg-white rounded border border-primary-100 px-2 py-1.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[#2a251a] truncate">
                        {c.name}
                      </div>
                      <div className="text-[10px] font-mono text-neutral-500 truncate">
                        {c.id}
                      </div>
                    </div>
                    <button
                      onClick={() => copy(c.id)}
                      className="p-1 rounded hover:bg-primary-100 shrink-0"
                      title="Copy class ID"
                    >
                      <Copy size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>

        <div className="px-6 py-4 border-t border-primary-100 flex items-center justify-end gap-2 bg-neutral-50">
          <button
            onClick={onClose}
            disabled={createAndImport.isPending}
            className="h-9 px-4 rounded-md text-sm font-medium text-neutral-700 border border-neutral-300 bg-white hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            disabled={
              createAndImport.isPending || !schemaId || !setName || (!parsed && !csvGeometryReady)
            }
            onClick={() => createAndImport.mutate()}
            className="inline-flex items-center gap-2 rounded-md text-white text-sm font-semibold px-4 h-9 disabled:opacity-50"
            style={{ background: createAndImport.isPending ? BROWN_HOVER : BROWN }}
          >
            <Upload size={14} />
            {createAndImport.isPending ? 'Importing…' : 'Create set & import'}
          </button>
        </div>
      </div>
    </div>
  );
}
