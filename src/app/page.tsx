import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Cormorant_Garamond } from 'next/font/google';
import {
  Map,
  Layers,
  Cpu,
  Activity,
  Bell,
  TreePine,
  Satellite,
  BarChart3,
  ArrowRight,
  ChevronRight,
  Scan,
} from 'lucide-react';

const display = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});

export default async function LandingPage() {
  const { userId } = await auth();
  if (userId) redirect('/workspace');

  return (
    <div
      className={display.variable}
      style={{ backgroundColor: '#f5ede0', color: '#2e3428', fontFamily: 'var(--font-sans, system-ui)' }}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-lg focus:outline-none"
        style={{ backgroundColor: '#7f5539', color: '#f5ede0' }}
      >
        Skip to main content
      </a>

      {/* ── Navigation ── */}
      <nav
        aria-label="Main navigation"
        style={{ backgroundColor: '#2e3428', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        className="sticky top-0 z-50"
      >
        <div className="max-w-7xl mx-auto px-6 lg:px-8 flex justify-between items-center h-[52px]">
          <div className="flex items-center gap-2.5">
            <TreePine className="w-5 h-5" style={{ color: '#c4985c' }} aria-hidden="true" />
            <span
              style={{ fontFamily: 'var(--font-display)', color: '#f5ede0', fontSize: '1.125rem', letterSpacing: '-0.01em', fontWeight: 600 }}
            >
              GeoTalos
            </span>
          </div>
          <div className="flex items-center gap-5">
            <Link
              href="/sign-in"
              className="text-sm font-medium transition-opacity hover:opacity-70"
              style={{ color: '#d4b896' }}
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="px-4 py-1.5 text-sm font-semibold rounded-lg transition-all hover:opacity-90"
              style={{ backgroundColor: '#7f5539', color: '#f5ede0' }}
            >
              Get started
            </Link>
          </div>
        </div>
      </nav>

      <main id="main-content">
        {/* ── Hero ── */}
        <section
          className="relative overflow-hidden flex items-center"
          style={{ minHeight: '90vh' }}
        >
          {/* Subtle grid texture */}
          <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
            <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
                  <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#7f5539" strokeWidth="0.4" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" opacity="0.06" />
            </svg>
          </div>

          <div className="max-w-7xl mx-auto px-6 lg:px-8 py-20 w-full">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              {/* Text */}
              <div>
                <div
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full mb-10"
                  style={{ backgroundColor: '#e8d5b8', color: '#7f5539', fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}
                >
                  <TreePine className="w-3 h-3" aria-hidden="true" />
                  Geospatial AI Platform
                </div>

                <h1
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'clamp(3.75rem, 8vw, 6rem)',
                    lineHeight: 1,
                    color: '#2e3428',
                    fontWeight: 700,
                    marginBottom: '1.75rem',
                  }}
                >
                  Monitor.<br />
                  <em style={{ color: '#7f5539', fontStyle: 'italic' }}>Protect.</em><br />
                  Sustain.
                </h1>

                <p
                  style={{
                    fontSize: '1.0625rem',
                    lineHeight: 1.65,
                    color: '#6a5c4e',
                    maxWidth: '440px',
                    marginBottom: '2.5rem',
                  }}
                >
                  GeoTalos unifies satellite imagery, AI inference, and annotation
                  workflows into one platform — built for the guardians of the world's
                  forests.
                </p>

                <div className="flex items-center gap-5 flex-wrap">
                  <Link
                    href="/sign-up"
                    className="inline-flex items-center gap-2 rounded-xl font-semibold transition-all hover:opacity-90"
                    style={{ backgroundColor: '#7f5539', color: '#f5ede0', padding: '0.875rem 1.75rem', fontSize: '0.9375rem' }}
                  >
                    Start for free
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </Link>
                  <Link
                    href="/sign-in"
                    className="inline-flex items-center gap-1.5 font-medium transition-opacity hover:opacity-70"
                    style={{ color: '#7f5539', fontSize: '0.9375rem' }}
                  >
                    Open workspace
                    <ChevronRight className="w-4 h-4" aria-hidden="true" />
                  </Link>
                </div>

                {/* Platform capability strip */}
                <div
                  className="flex gap-10 mt-14 pt-8"
                  style={{ borderTop: '1px solid #d4c0a8' }}
                >
                  {STATS.map((s) => (
                    <div key={s.label}>
                      <div
                        style={{ fontFamily: 'var(--font-display)', fontSize: '1.125rem', fontWeight: 600, color: '#7f5539' }}
                      >
                        {s.value}
                      </div>
                      <div
                        style={{ fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#9a8878', marginTop: '2px' }}
                      >
                        {s.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Forest canopy visualization */}
              <div className="relative hidden lg:flex items-center justify-center" style={{ height: '500px' }}>
                <ForestCanopy />
              </div>
            </div>
          </div>
        </section>

        {/* ── Manifesto strip ── */}
        <section
          style={{ backgroundColor: '#2e3428', color: '#f5ede0' }}
          className="py-16"
        >
          <div className="max-w-3xl mx-auto px-6 text-center">
            <p
              style={{
                fontFamily: 'var(--font-display)',
                fontStyle: 'italic',
                fontSize: 'clamp(1.4rem, 3vw, 1.875rem)',
                lineHeight: 1.45,
                color: '#e8d5b8',
              }}
            >
              "From satellite to decision — in a single platform designed for those
              who protect the world's forests."
            </p>
          </div>
        </section>

        {/* ── Features — editorial layout ── */}
        <section className="py-24" style={{ backgroundColor: '#f5ede0' }}>
          <div className="max-w-7xl mx-auto px-6 lg:px-8">
            <div className="grid lg:grid-cols-2 gap-16">
              <div className="lg:sticky lg:top-24 lg:self-start">
                <h2
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'clamp(2rem, 4vw, 3rem)',
                    lineHeight: 1.1,
                    color: '#2e3428',
                    fontWeight: 700,
                    marginBottom: '1rem',
                  }}
                >
                  Every tool.<br />One platform.
                </h2>
                <p style={{ fontSize: '0.9375rem', color: '#8a7868', maxWidth: '280px', lineHeight: 1.65 }}>
                  Purpose-built for conservation scientists and forestry professionals
                  who need precision at scale.
                </p>

                <div className="mt-10">
                  <Link
                    href="/sign-up"
                    className="inline-flex items-center gap-2 font-semibold transition-opacity hover:opacity-80"
                    style={{ color: '#7f5539', fontSize: '0.9375rem' }}
                  >
                    Explore the platform
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </Link>
                </div>
              </div>

              <div>
                {FEATURES.map((feature, i) => (
                  <div
                    key={feature.title}
                    className="flex items-start gap-4 py-5"
                    style={{ borderTop: '1px solid #d4c0a8' }}
                  >
                    <span
                      className="font-mono shrink-0 pt-0.5"
                      style={{ fontSize: '0.6875rem', color: '#b0a090', width: '1.5rem' }}
                    >
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div
                      className="rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: '#e8d5b8', width: '2rem', height: '2rem' }}
                    >
                      <feature.icon className="w-4 h-4" style={{ color: '#7f5539' }} aria-hidden="true" />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#2e3428', marginBottom: '2px' }}>
                        {feature.title}
                      </h3>
                      <p style={{ fontSize: '0.875rem', lineHeight: 1.65, color: '#7a6e5e' }}>
                        {feature.desc}
                      </p>
                    </div>
                  </div>
                ))}
                <div style={{ borderTop: '1px solid #d4c0a8' }} />
              </div>
            </div>
          </div>
        </section>

        {/* ── Closing CTA ── */}
        <section className="py-24" style={{ backgroundColor: '#414833' }}>
          <div className="max-w-2xl mx-auto px-6 text-center">
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'clamp(2rem, 4vw, 3.25rem)',
                lineHeight: 1.1,
                color: '#f5ede0',
                fontWeight: 700,
                marginBottom: '1.25rem',
              }}
            >
              Ready to protect your forests?
            </h2>
            <p style={{ fontSize: '1rem', lineHeight: 1.65, color: '#b8c9a0', marginBottom: '2.5rem' }}>
              Join conservation teams using GeoTalos to detect deforestation,
              run AI inference, and respond to environmental threats — faster.
            </p>
            <Link
              href="/sign-up"
              className="inline-flex items-center gap-2 rounded-xl font-semibold transition-all hover:opacity-90"
              style={{ backgroundColor: '#f5ede0', color: '#7f5539', padding: '1rem 2rem', fontSize: '0.9375rem' }}
            >
              Create your workspace
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer
        style={{ backgroundColor: '#2e3428', borderTop: '1px solid rgba(255,255,255,0.06)' }}
        className="py-7"
      >
        <div className="max-w-7xl mx-auto px-6 lg:px-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TreePine className="w-4 h-4" style={{ color: '#c4985c' }} aria-hidden="true" />
            <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#8a9a7a' }}>GeoTalos</span>
          </div>
          <p style={{ fontSize: '0.75rem', color: '#5a6a5a' }}>
            &copy; {new Date().getFullYear()} GeoTalos. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

// ── Forest canopy SVG visualization ──────────────────────────────────────
function ForestCanopy() {
  return (
    <div className="relative w-full h-full select-none" aria-hidden="true">
      <svg
        viewBox="0 0 440 440"
        className="absolute inset-0 w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Topographic rings */}
        {[380, 315, 255, 200, 148, 100, 58].map((r, i) => (
          <circle
            key={r}
            cx="220" cy="220" r={r}
            fill="none"
            stroke={i % 2 === 0 ? '#c4985c' : '#7f5539'}
            strokeWidth="0.6"
            opacity={0.08 + i * 0.025}
          />
        ))}

        {/* Forest canopy — organic ellipses */}
        {CANOPY_BLOBS.map((blob, i) => (
          <ellipse
            key={i}
            cx={blob.cx} cy={blob.cy}
            rx={blob.rx} ry={blob.ry}
            fill={blob.fill}
            opacity={blob.opacity}
          />
        ))}

        {/* Center crosshair */}
        <circle cx="220" cy="220" r="5" fill="#7f5539" opacity="0.85" />
        <circle cx="220" cy="220" r="2" fill="#f5ede0" />
        {[[-14, 0], [14, 0], [0, -14], [0, 14]].map(([dx, dy], i) => (
          <line
            key={i}
            x1={220 + dx * 0.4} y1={220 + dy * 0.4}
            x2={220 + dx} y2={220 + dy}
            stroke="#7f5539" strokeWidth="1" opacity="0.55"
          />
        ))}

        {/* Coordinate labels */}
        <text x="24" y="418" fill="#c4985c" fontSize="9" opacity="0.45" fontFamily="monospace">−3.4653° N  −62.2159° W</text>

        {/* Scale bar */}
        <line x1="280" y1="408" x2="360" y2="408" stroke="#c4985c" strokeWidth="1.5" opacity="0.35" />
        <line x1="280" y1="403" x2="280" y2="413" stroke="#c4985c" strokeWidth="1" opacity="0.35" />
        <line x1="360" y1="403" x2="360" y2="413" stroke="#c4985c" strokeWidth="1" opacity="0.35" />
        <text x="302" y="401" fill="#c4985c" fontSize="8" opacity="0.4" fontFamily="monospace">10 km</text>

        {/* Detection box */}
        <rect x="145" y="148" width="60" height="50" fill="none" stroke="#c4985c" strokeWidth="0.75" opacity="0.4" strokeDasharray="3 2" />
        <text x="148" y="143" fill="#c4985c" fontSize="7.5" opacity="0.5" fontFamily="monospace">Δ −2.3%</text>
      </svg>

      {/* Floating metadata tags */}
      <div className="absolute top-6 right-6 text-right" style={{ opacity: 0.65 }}>
        <div style={{ fontSize: '0.6875rem', fontFamily: 'monospace', color: '#7f5539', lineHeight: 1.6 }}>
          Zoom 8 · COG
        </div>
        <div style={{ fontSize: '0.6875rem', fontFamily: 'monospace', color: '#a68a64' }}>
          Amazon Basin
        </div>
      </div>

      <div className="absolute bottom-10 left-6" style={{ opacity: 0.55 }}>
        <div
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded"
          style={{ backgroundColor: '#e8d5b8', fontSize: '0.625rem', color: '#7f5539', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}
        >
          <Scan className="w-3 h-3" />
          Live monitoring
        </div>
      </div>
    </div>
  );
}

const CANOPY_BLOBS = [
  { cx: 220, cy: 218, rx: 50, ry: 54, fill: '#414833', opacity: 0.92 },
  { cx: 172, cy: 194, rx: 38, ry: 43, fill: '#656d4a', opacity: 0.88 },
  { cx: 266, cy: 200, rx: 34, ry: 38, fill: '#414833', opacity: 0.82 },
  { cx: 195, cy: 262, rx: 44, ry: 38, fill: '#5a6148', opacity: 0.88 },
  { cx: 248, cy: 255, rx: 38, ry: 43, fill: '#656d4a', opacity: 0.78 },
  { cx: 145, cy: 222, rx: 28, ry: 33, fill: '#7f5539', opacity: 0.38 },
  { cx: 298, cy: 232, rx: 22, ry: 27, fill: '#7f5539', opacity: 0.32 },
  { cx: 215, cy: 168, rx: 28, ry: 22, fill: '#7f5539', opacity: 0.42 },
  { cx: 225, cy: 272, rx: 22, ry: 22, fill: '#656d4a', opacity: 0.58 },
  { cx: 182, cy: 205, rx: 14, ry: 16, fill: '#c4985c', opacity: 0.28 },
  { cx: 252, cy: 240, rx: 12, ry: 14, fill: '#a68a64', opacity: 0.25 },
  { cx: 238, cy: 182, rx: 10, ry: 12, fill: '#c4985c', opacity: 0.22 },
];

const STATS = [
  { value: 'Real-time', label: 'Job monitoring' },
  { value: 'COG', label: 'Raster support' },
  { value: 'Org-based', label: 'Collaboration' },
];

const FEATURES = [
  {
    icon: Map,
    title: 'Interactive Map Explorer',
    desc: 'Visualize datasets, annotations, and tracked objects on a live geospatial map with dynamic layer controls and COG raster rendering.',
  },
  {
    icon: Satellite,
    title: 'Dataset Management',
    desc: 'Ingest and browse large geospatial datasets with direct S3 multipart upload, STAC collection support, and item-level browsing.',
  },
  {
    icon: Layers,
    title: 'Annotation Workflows',
    desc: 'Create, review, and export polygon annotations with label schema management, versioning, and bulk import/export.',
  },
  {
    icon: Cpu,
    title: 'AI Model Inference',
    desc: 'Run detection and segmentation models on any dataset. Track job progress and review outputs inline on the map.',
  },
  {
    icon: Activity,
    title: 'Change Detection & Analysis',
    desc: 'Timeseries queries and change detection over multi-temporal imagery with exportable results and area statistics.',
  },
  {
    icon: Bell,
    title: 'Alerts & Automations',
    desc: 'Subscribe to area-of-interest alerts with configurable thresholds, and schedule automated inference workflows.',
  },
  {
    icon: BarChart3,
    title: 'Object Tracking',
    desc: 'Track objects across time with observation timelines, priority queuing, and merge conflict resolution.',
  },
  {
    icon: TreePine,
    title: 'Multi-Org Collaboration',
    desc: 'Manage members and roles per workspace. Isolate data per organization with fine-grained Clerk-based permissions.',
  },
];
