'use client';

interface StyleSwatchProps {
  fill: string;
  stroke: string;
  size?: number;
}

export function StyleSwatch({ fill, stroke, size = 20 }: StyleSwatchProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
      <rect
        x="2"
        y="2"
        width="16"
        height="16"
        rx="3"
        fill={fill}
        stroke={stroke}
        strokeWidth="2"
      />
    </svg>
  );
}
