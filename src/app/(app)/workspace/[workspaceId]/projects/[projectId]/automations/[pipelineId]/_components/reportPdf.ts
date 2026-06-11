/**
 * Build a clean, reorganized PDF from a pipeline report payload.
 *
 * Generates the PDF from the structured report data (not a DOM screenshot), so
 * the layout is fully controlled: a title block, then one section per
 * annotation set (totals + per-class table) and one block per raster-metrics
 * comparison (overall summary + per-class IoU/precision/recall/F1 table).
 * Tables auto-paginate via jspdf-autotable.
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

import type { ReportMetrics, ReportPayload, ReportSection } from './DisplayNodeContent';

// Golden-brown brand accent (#7f5539) for table headers.
const ACCENT: [number, number, number] = [127, 85, 57];
const MUTED: [number, number, number] = [120, 110, 95];
const MARGIN = 14;

function fmtNum(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtRatio(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : v.toFixed(3);
}

function fmtPct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`;
}

function hectares(ha?: number | null, sqm?: number | null): number {
  if (typeof ha === 'number') return ha;
  if (typeof sqm === 'number') return sqm / 10_000;
  return 0;
}

/** Current y just below the last drawn table (or a fallback). */
function afterTable(doc: jsPDF, fallback: number): number {
  const last = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  return last ? last.finalY : fallback;
}

/** Add a page break if the cursor is too close to the bottom. */
function ensureSpace(doc: jsPDF, y: number, needed = 28): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + needed > pageHeight - MARGIN) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

function heading(doc: jsPDF, text: string, y: number, size = 12): number {
  const yy = ensureSpace(doc, y, 16);
  doc.setFontSize(size);
  doc.setTextColor(20, 18, 14);
  doc.text(text, MARGIN, yy);
  return yy + 5;
}

function subtle(doc: jsPDF, text: string, y: number): number {
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(text, MARGIN, y);
  return y + 5;
}

function metricsBlock(doc: jsPDF, m: ReportMetrics, y: number): number {
  const title =
    m.prediction?.name && m.ground_truth?.name
      ? `Metrics — ${m.prediction.name} vs ${m.ground_truth.name}`
      : 'Raster Mask Metrics';
  let yy = heading(doc, title, y);

  const o = m.overall ?? {};
  yy = subtle(
    doc,
    `Mean IoU ${fmtRatio(o.mean_iou)}  ·  Pixel accuracy ${fmtPct(o.pixel_accuracy)}` +
      `  ·  Foreground accuracy ${fmtPct(o.foreground_accuracy)}  ·  ${o.class_count ?? 0} classes`,
    yy,
  );

  const rows = (m.per_class ?? [])
    .slice()
    .sort((a, b) => (b.iou ?? -1) - (a.iou ?? -1))
    .map((c) => [
      c.class_name,
      fmtRatio(c.iou),
      fmtRatio(c.precision),
      fmtRatio(c.recall),
      fmtRatio(c.f1_score),
      fmtNum(c.gt_pixels),
      fmtNum(c.pred_pixels),
    ]);

  if (rows.length > 0) {
    autoTable(doc, {
      head: [['Class', 'IoU', 'Precision', 'Recall', 'F1', 'GT px', 'Pred px']],
      body: rows,
      startY: yy + 1,
      margin: { left: MARGIN, right: MARGIN },
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: ACCENT, textColor: 245, fontSize: 8 },
      columnStyles: {
        1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' },
        4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' },
      },
    });
    yy = afterTable(doc, yy) + 8;
  }
  return yy;
}

function sectionBlock(doc: jsPDF, s: ReportSection, idx: number, y: number): number {
  if (s.missing) {
    return subtle(doc, `Set ${s.annotation_set_id ?? idx} — missing from database`, heading(doc, `Section ${idx + 1}`, y));
  }
  let yy = heading(doc, s.name ?? `Section ${idx + 1}`, y);

  const t = s.totals ?? {};
  const meta = [
    s.model && `Model: ${s.model}`,
    s.schema && `Schema: ${s.schema}`,
    s.source_type && `Source: ${s.source_type}`,
  ].filter(Boolean).join('  ·  ');
  if (meta) yy = subtle(doc, meta, yy);
  yy = subtle(
    doc,
    `${fmtNum(t.annotation_count)} annotations  ·  ${hectares(t.total_area_hectares, t.total_area_sqm).toFixed(2)} ha` +
      (t.avg_confidence != null ? `  ·  avg conf ${t.avg_confidence.toFixed(3)}` : ''),
    yy,
  );

  const rows = (s.per_class ?? []).map((c) => [
    c.class,
    fmtNum(c.count),
    (c.area_hectares ?? c.area_sqm / 10_000).toFixed(3),
    c.avg_confidence != null ? c.avg_confidence.toFixed(3) : '—',
  ]);
  if (rows.length > 0) {
    autoTable(doc, {
      head: [['Class', 'Count', 'Area (ha)', 'Avg Conf']],
      body: rows,
      startY: yy + 1,
      margin: { left: MARGIN, right: MARGIN },
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: ACCENT, textColor: 245, fontSize: 8 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    });
    yy = afterTable(doc, yy) + 8;
  }
  return yy;
}

export function downloadReportPdf(report: ReportPayload): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const title = report.title ?? 'Pipeline Report';

  // Title block
  doc.setFontSize(17);
  doc.setTextColor(20, 18, 14);
  doc.text(title, MARGIN, 18);

  const sections = Array.isArray(report.sections) ? report.sections : [];
  const metrics = Array.isArray(report.metrics) ? report.metrics : [];
  const sum = report.summary;
  const summaryLine = [
    sum?.total_annotations != null && `${fmtNum(sum.total_annotations)} annotations`,
    sum && `${hectares(sum.total_area_hectares, sum.total_area_sqm).toFixed(2)} ha`,
    `${sections.length} set${sections.length === 1 ? '' : 's'}`,
    metrics.length > 0 && `${metrics.length} metric${metrics.length === 1 ? '' : 's'}`,
    report.generated_at && `generated ${new Date(report.generated_at).toLocaleString()}`,
  ].filter(Boolean).join('  ·  ');
  let y = subtle(doc, summaryLine, 25) + 3;

  // Metrics first (the comparison is usually the headline), then per-set sections.
  for (const m of metrics) y = metricsBlock(doc, m, y);
  sections.forEach((s, i) => { y = sectionBlock(doc, s, i, y); });

  // Page footer with page numbers.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    doc.text(`${p} / ${pages}`, w - MARGIN, h - 8, { align: 'right' });
  }

  const safe = title.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'report';
  doc.save(`${safe}.pdf`);
}
