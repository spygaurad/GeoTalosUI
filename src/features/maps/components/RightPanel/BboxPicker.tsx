'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Loader2, Trash2, Eraser } from 'lucide-react';
import { MC } from '../../mapColors';

interface BboxPickerProps {
  /** Data URL of the AOI preview image. */
  previewDataUrl: string | null;
  /** Native pixel dimensions of the preview. Bboxes are reported in this coord space. */
  previewWidth: number;
  previewHeight: number;
  isLoading?: boolean;
  error?: string | null;
  value: Array<[number, number, number, number]>;
  onChange: (boxes: Array<[number, number, number, number]>) => void;
}

const MAX_DISPLAY_WIDTH = 320;

export function BboxPicker({
  previewDataUrl,
  previewWidth,
  previewHeight,
  isLoading,
  error,
  value,
  onChange,
}: BboxPickerProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);

  // Display dimensions (CSS) — scale to fit MAX_DISPLAY_WIDTH while keeping aspect.
  const scale = previewWidth > 0 ? Math.min(1, MAX_DISPLAY_WIDTH / previewWidth) : 1;
  const dispW = Math.max(1, Math.round(previewWidth * scale));
  const dispH = Math.max(1, Math.round(previewHeight * scale));

  const dispToImage = useCallback(
    (px: number, py: number): [number, number] => [
      Math.max(0, Math.min(previewWidth, px / scale)),
      Math.max(0, Math.min(previewHeight, py / scale)),
    ],
    [previewWidth, previewHeight, scale],
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!previewDataUrl) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDragStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setDragCurrent({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragStart) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDragCurrent({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handleMouseUp = () => {
    if (!dragStart || !dragCurrent) {
      setDragStart(null);
      setDragCurrent(null);
      return;
    }
    const [ix1, iy1] = dispToImage(dragStart.x, dragStart.y);
    const [ix2, iy2] = dispToImage(dragCurrent.x, dragCurrent.y);
    const x1 = Math.min(ix1, ix2);
    const y1 = Math.min(iy1, iy2);
    const x2 = Math.max(ix1, ix2);
    const y2 = Math.max(iy1, iy2);
    // Reject tiny drags (likely accidental clicks).
    if (x2 - x1 > 4 && y2 - y1 > 4) {
      onChange([...value, [x1, y1, x2, y2]]);
    }
    setDragStart(null);
    setDragCurrent(null);
  };

  const removeBox = (idx: number) => onChange(value.filter((_, i) => i !== idx));
  const clearAll = () => onChange([]);

  // Cancel drag if mouse leaves the picker while pressed.
  useEffect(() => {
    if (!dragStart) return;
    const onUp = () => {
      setDragStart(null);
      setDragCurrent(null);
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [dragStart]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        ref={wrapRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{
          position: 'relative',
          width: previewDataUrl ? dispW : '100%',
          height: previewDataUrl ? dispH : 120,
          border: `1px solid ${MC.border}`,
          borderRadius: 5,
          background: MC.inputBg ?? '#1e2518',
          overflow: 'hidden',
          cursor: previewDataUrl ? 'crosshair' : 'default',
          userSelect: 'none',
        }}
      >
        {isLoading ? (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 6, color: MC.textMuted, fontSize: 10,
          }}>
            <Loader2 size={11} className="animate-spin" /> Loading preview…
          </div>
        ) : error ? (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#dc2626', fontSize: 10, padding: 8, textAlign: 'center',
          }}>
            {error}
          </div>
        ) : previewDataUrl ? (
          <>
            <img
              src={previewDataUrl}
              alt="AOI preview"
              draggable={false}
              style={{
                position: 'absolute', inset: 0,
                width: dispW, height: dispH,
                pointerEvents: 'none',
              }}
            />
            {value.map((b, i) => {
              const [x1, y1, x2, y2] = b;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: x1 * scale,
                    top: y1 * scale,
                    width: (x2 - x1) * scale,
                    height: (y2 - y1) * scale,
                    border: `1.5px solid ${MC.accent}`,
                    background: 'rgba(140,109,44,0.18)',
                    pointerEvents: 'none',
                  }}
                />
              );
            })}
            {dragStart && dragCurrent && (
              <div
                style={{
                  position: 'absolute',
                  left: Math.min(dragStart.x, dragCurrent.x),
                  top: Math.min(dragStart.y, dragCurrent.y),
                  width: Math.abs(dragCurrent.x - dragStart.x),
                  height: Math.abs(dragCurrent.y - dragStart.y),
                  border: `1.5px dashed ${MC.accent}`,
                  background: 'rgba(140,109,44,0.10)',
                  pointerEvents: 'none',
                }}
              />
            )}
          </>
        ) : (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: MC.textMuted, fontSize: 10, padding: 8, textAlign: 'center',
          }}>
            Pick a source item below to load a preview.
          </div>
        )}
      </div>

      {value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          {value.map((b, i) => (
            <button
              key={i}
              type="button"
              onClick={() => removeBox(i)}
              title="Remove this bbox"
              style={{
                display: 'flex', alignItems: 'center', gap: 3,
                padding: '2px 6px', borderRadius: 3, fontSize: 9,
                border: `1px solid ${MC.border}`, background: 'transparent',
                color: MC.textSecondary, cursor: 'pointer',
              }}
            >
              <Trash2 size={9} />
              {Math.round(b[0])},{Math.round(b[1])}–{Math.round(b[2])},{Math.round(b[3])}
            </button>
          ))}
          <button
            type="button"
            onClick={clearAll}
            style={{
              display: 'flex', alignItems: 'center', gap: 3,
              padding: '2px 6px', borderRadius: 3, fontSize: 9,
              border: `1px solid ${MC.border}`, background: 'transparent',
              color: MC.textSecondary, cursor: 'pointer', marginLeft: 'auto',
            }}
          >
            <Eraser size={9} /> Clear
          </button>
        </div>
      )}

      {previewDataUrl && (
        <span style={{ fontSize: 8, color: MC.textMuted }}>
          Drag on the image to draw exemplar bboxes ({previewWidth}×{previewHeight}px).
        </span>
      )}
    </div>
  );
}
