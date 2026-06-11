# GeoTalos — Frontend Architecture (Updated)

> **Reference:** Backend schema (PostgreSQL + PostGIS + pgSTAC)  
> **Stack:** Next.js 15 · TanStack Query v5 · Zustand v4 · Leaflet · shadcn/ui

This document defines the frontend architecture for the GeoTalos Geospatial AI Platform. It aligns with the backend data model and supports all core workflows: map‑centric analysis, annotation management, AI inference, bulk operations, and real‑time job monitoring.

---

## 📦 Library Stack

Versions reflect what is **actually installed** in `package.json`.

| Category               | Library                                            | Installed | Architecture Note                                                                                   |
| ---------------------- | -------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------- |
| Framework              | `next`                                             | 15.x      | App Router; SSR/RSC for public pages; client components for map/interactive UI.                     |
| Auth                   | `@clerk/nextjs`                                    | **7.x**   | Matches backend Clerk JWT auth; org‑aware; handles sign‑in/org‑switching.                           |
| Server state           | `@tanstack/react-query`                            | 5.x       | Queries, mutations, polling (job progress), cache invalidation.                                    |
| Client state           | `zustand`                                          | **4.x**   | Map viewport, active layers, panel toggles — no boilerplate.                                       |
| Map                    | `leaflet` + `react-leaflet`                        | L 1.9 / RL 4.x | Lightweight; supports tile overlays from titiler; good GeoJSON layer.                              |
| Map draw               | `@geoman-io/leaflet-geoman-free`                   | 2.x       | Polygon/rectangle/point AOI drawing on Leaflet maps.                                               |
| COG display            | `georaster` + `georaster-layer-for-leaflet` + `geotiff` + `plotty` | mixed     | Client‑side Cloud Optimized GeoTIFF rendering on Leaflet.                                           |
| Geospatial utils       | `@turf/turf`                                       | 7.x       | Client‑side bbox validation, area computation, geometry union.                                     |
| Forms                  | `react-hook-form` + `@hookform/resolvers` + `zod` | RHF 7.x / Zod **4.x** | Type‑safe forms; Zod schemas mirror backend Pydantic shapes.                                         |
| Tables                 | `@tanstack/react-table`                            | 8.x       | Headless; handles pagination, sorting, row selection for bulk ops.                                 |
| Charts                 | `recharts`                                         | 2.x       | Timeseries line charts, area change bar charts; small bundle.                                      |
| UI primitives          | `shadcn/ui` + `tailwindcss`                        | TW 3.4 (shadcn via CLI) | Radix‑based accessible components; matches dark geo‑platform aesthetic.                             |
| Component utils        | `clsx` + `tailwind-merge` + `class-variance-authority` | latest     | Required by shadcn/ui pattern.                                                                      |
| Icons                  | `lucide-react`                                     | 0.294.x   | Clean, consistent icon set.                                                                         |
| Date handling          | `date-fns`                                         | **3.x**   | Temporal range pickers, relative time display.                                                      |
| HTTP client            | `ky`                                               | 1.x       | Thin fetch wrapper; works in RSC + client; interceptors for auth headers.                          |
| File upload            | `@uppy/core` + `@uppy/aws-s3` + `@uppy/dashboard` | **5.x**   | Direct‑to‑S3 multipart upload for large rasters; progress events.                                   |
| Notifications          | `sonner`                                           | **2.x**   | Toast for job completion / alert triggers.                                                          |
| Animations             | `tailwindcss-animate` + `tw-animate-css`           | 1.x       | Required by shadcn/ui; tw-animate-css imported in globals.css.                                       |
| Display font           | `Cormorant Garamond` (next/font/google)            | —         | Editorial serif for landing page and marketing headings; `--font-display` CSS var.                  |

### 📦 Removed Packages

| Package          | Reason                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `minio`          | Server‑side S3 SDK — never use in browser; replaced with Uppy direct‑to‑S3.              |
| `ol` (OpenLayers)| Redundant with Leaflet; Leaflet is our single map library.                               |
| `axios`          | Redundant with `ky`; now using `ky` throughout (configured with Clerk auth interceptor). |
| `react-dropzone` | Replaced with Uppy (which includes drop + multipart upload).                             |

> **Actual installed versions (verified against `package.json`):**
> `@clerk/nextjs` 7.x · `zustand` 4.x · `zod` 4.x · `date-fns` 3.x · `sonner` 2.x ·
> `@uppy/*` 5.x · `@tanstack/react-table` 8.x · `recharts` 2.x · `@turf/turf` 7.x

---

## 🎨 Theming & Brand Settings

Branding is centralized across three files. The platform uses an **autumn forest palette** — burnt sienna, warm amber, sage green, and parchment — expressed as **OKLCH** CSS variables for perceptual uniformity.

### Canonical brand colors (`src/lib/theme.ts`)

| Token | Hex | Use |
|---|---|---|
| `coffeeBean` | `#7f5539` | Primary brand action (buttons, links, accents) |
| `camel` | `#a68a64` | Secondary / muted elements |
| `almondCream` | `#ede0d4` | Accent fills, card backgrounds |
| `dustyOlive` | `#656d4a` | Success states, alternate CTAs |
| `ebony` | `#414833` | Sidebar, dark section backgrounds |
| `parchment` | `#f5ede0` | Page background (light mode) |

### 1. CSS Variables (`src/app/globals.css`)

All semantic tokens use **OKLCH** — perceptually uniform, predictable alpha scaling:

```css
:root {
  /* Autumn raw palette */
  --coffee-bean:  oklch(0.44 0.10 39);  /* #7f5539 burnt sienna  */
  --camel:        oklch(0.64 0.07 58);  /* #a68a64 warm amber    */
  --almond-cream: oklch(0.93 0.03 74);  /* #ede0d4 parchment     */
  --dusty-olive:  oklch(0.48 0.06 133); /* #656d4a sage green    */
  --ebony:        oklch(0.28 0.04 133); /* #414833 deep forest   */

  /* Semantic mappings */
  --primary:            oklch(0.44 0.10 39);  /* burnt sienna     */
  --primary-foreground: oklch(0.97 0.02 74);  /* parchment        */
  --background:         oklch(0.97 0.02 74);  /* warm parchment   */
  --foreground:         oklch(0.22 0.04 133); /* deep forest      */
  --sidebar:            oklch(0.28 0.04 133); /* ebony            */
}
```

### 2. Tailwind Configuration (`tailwind.config.ts`)

Color references use `oklch(var(--token) / <alpha-value>)` to correctly compose with Tailwind's opacity modifier syntax (e.g. `bg-primary/80`). The `primary.*` numeric scale (50–900) uses hardcoded hex values for direct use without CSS vars.

```ts
primary: {
  500: '#7f5539',   // direct Tailwind classes: bg-primary-500
  DEFAULT: 'oklch(var(--primary) / <alpha-value>)',   // bg-primary
  foreground: 'oklch(var(--primary-foreground) / <alpha-value>)',
}
```

### 3. Clerk Theming (`src/app/layout.tsx`)

```tsx
import { theme } from '@/lib/theme';

<ClerkProvider
  appearance={{
    variables: {
      colorPrimary:    theme.primary,      // '#7f5539'
      colorBackground: theme.almondCream,
      colorText:       theme.ebony,
    },
    elements: {
      formButtonPrimary: 'bg-primary-600 hover:bg-primary-700',
      footerActionLink:  'text-primary-600',
    },
  }}
>
```

### 4. Display Typography

The landing page uses **Cormorant Garamond** (`next/font/google`) as `--font-display` for editorial headings. Body text uses **Geist** via `--font-sans`. Import the display font where needed:

```ts
import { Cormorant_Garamond } from 'next/font/google';
const display = Cormorant_Garamond({ subsets: ['latin'], weight: ['400','600','700'], variable: '--font-display' });
```

### 5. Changing the Brand Globally

1. Update `src/lib/theme.ts` hex values.
2. Update the matching `oklch()` values in `src/app/globals.css`.
3. Update the numeric scale in `tailwind.config.ts` if needed.
4. All components (shadcn/ui, Clerk, scrollbars, range sliders) inherit automatically.

---

## 🧱 Folder Structure

The structure is organized by **domain** (mirroring backend entities) and **feature**, keeping the `app` router thin.

src/
│
├── middleware.ts               # Clerk route protection (at src/ level)
├── app/                            # Next.js App Router
│   ├── globals.css                 # Tailwind base + CSS variables
│   ├── layout.tsx                  # Root layout: ClerkProvider, QueryProvider, Toaster
│   ├── page.tsx                    # Public landing page → redirects auth users to /dashboard
│   │
│   ├── (auth)/                     # Public auth pages (no sidebar)
│   │   ├── layout.tsx              # Centered layout with GeoTalos branding
│   │   ├── sign-in/[[...sign-in]]/page.tsx
│   │   ├── sign-up/[[...sign-up]]/page.tsx
│   │   └── select-org/page.tsx     # Clerk OrganizationList — after sign‑up
│   │
│   └── (app)/                      # Authenticated layout group
│       ├── layout.tsx              # Auth guard (userId + orgId) + TopNav + Sidebar
│       │
│       └── workspace/[workspaceId]/           # Workspace context
│           ├── page.tsx             # Workspace dashboard (stats, quick links, recent jobs)
│           ├── map/                  # Map Explorer (primary view — full‑screen Leaflet)
│           │   └── page.tsx
│           │
│           ├── projects/             # Workspace projects
│           │   ├── page.tsx          # Project list
│           │   └── [projectId]/
│           │       ├── page.tsx      # Project overview (tabs: Overview · Maps · Datasets · Members)
│           │       └── maps/          # Maps within a project
│           │           ├── page.tsx
│           │           └── [mapId]/page.tsx
│           │
│           ├── datasets/              # STAC collections & items
│           │   ├── page.tsx
│           │   ├── new/page.tsx       # Dataset creation form + S3 upload (Uppy)
│           │   └── [id]/
│           │       ├── page.tsx
│           │       └── items/page.tsx
│           │
│           ├── annotation-schemas/    # Taxonomies
│           │   ├── page.tsx
│           │   ├── new/page.tsx
│           │   └── [id]/page.tsx
│           │
│           ├── annotation-sets/       # Groups of annotations on a map
│           │   ├── page.tsx
│           │   ├── new/page.tsx
│           │   ├── [id]/page.tsx
│           │   └── bulk/               # Bulk operations
│           │       ├── import/page.tsx
│           │       ├── update/page.tsx
│           │       └── export/page.tsx
│           │
│           ├── models/                 # AI models
│           │   ├── page.tsx
│           │   ├── new/page.tsx
│           │   └── [id]/page.tsx
│           │
│           ├── inference/               # Run models
│           │   └── new/page.tsx
│           │
│           ├── jobs/                    # Background tasks
│           │   ├── page.tsx
│           │   └── [id]/page.tsx
│           │
│           ├── automations/              # Scheduled workflows
│           │   ├── page.tsx
│           │   └── new/page.tsx
│           │
│           └── settings/                 # Workspace settings
│               ├── page.tsx              # Redirect → /settings/members
│               ├── members/page.tsx      # Uses Clerk <OrganizationProfile />
│               ├── api-keys/page.tsx
│               ├── basemaps/page.tsx
│               ├── bookmarks/page.tsx
│               └── audit-log/page.tsx
│
├── components/                           # [Same as before]
│   ├── layout/
│   │   ├── TopNav.tsx
│   │   ├── Sidebar.tsx
│   │   ├── SidebarNavItem.tsx
│   │   └── JobStatusBar.tsx
│   ├── map/
│   │   ├── MapContainer.tsx
│   │   ├── BasemapLayer.tsx
│   │   ├── DatasetItemLayer.tsx
│   │   ├── AnnotationLayer.tsx
│   │   ├── PredictionLayer.tsx
│   │   ├── DrawControl.tsx
│   │   ├── BookmarkControl.tsx
│   │   ├── LayerPanel.tsx
│   │   ├── MapSearch.tsx
│   │   └── TitilerLayer.tsx
│   ├── jobs/
│   │   ├── JobProgressBar.tsx
│   │   ├── JobStatusBadge.tsx
│   │   └── JobPoller.tsx
│   ├── annotations/
│   │   ├── AnnotationClassBadge.tsx
│   │   ├── AnnotationSourceBadge.tsx
│   │   ├── ConfidenceSlider.tsx
│   │   └── GeometryPreview.tsx
│   ├── data-table/
│   │   ├── DataTable.tsx
│   │   ├── DataTablePagination.tsx
│   │   ├── DataTableToolbar.tsx
│   │   └── BulkActionBar.tsx
│   └── ui/                         # shadcn/ui generated components
│
├── features/                       # Feature‑specific code, co‑located by domain
│   ├── projects/       # components/ hooks/ types.ts
│   ├── datasets/       # components/ hooks/ types.ts
│   ├── annotation-schemas/   # components/ hooks/ types.ts
│   ├── annotation-sets/       # components/ hooks/ types.ts
│   ├── models/         # components/ hooks/ types.ts
│   ├── inference/      # components/ hooks/ types.ts
│   ├── jobs/           # components/ hooks/ types.ts
│   ├── automations/    # components/ hooks/ types.ts
│   └── settings/       # components/ hooks/ types.ts
│
├── lib/                             # [Same as before]
│   ├── api/
│   │   ├── client.ts
│   │   ├── workspaces.ts / projects.ts / ...
│   ├── query-client.tsx
│   ├── query-keys.ts
│   └── geo.ts
│
├── store/                           # [Same as before]
│   ├── mapStore.ts
│   ├── jobStore.ts
│   └── filterStore.ts
│
├── hooks/                           # [Same as before]
│   ├── use-hoverable-sidebar.ts
│   └── use-map-layers.ts
│
└── types/                           # [Same as before]
    ├── api.ts
    ├── geo.ts
    └── common.ts
---

Components vs. Features – What Goes Where?
components/ – Reusable UI building blocks that are not tied to any specific feature.
Examples:

MapContainer.tsx: initializes Leaflet map, handles viewport, and exposes map instance via context. It doesn't know about projects, datasets, or annotations – just renders a map.

AnnotationLayer.tsx: accepts an array of annotations and renders them as Leaflet layers. It's agnostic of where those annotations come from.

DataTable.tsx: a generic table with pagination, sorting, and selection – can be used for projects, datasets, jobs, etc.

JobStatusBadge.tsx: displays a job status badge based on a status string.

These components typically:

Receive data via props (not fetching themselves).

May have internal state but no business logic.

Are exported for use anywhere.

features/ – Feature‑specific code that implements a particular domain.
Each feature folder contains:

components/: Components that are only used within that feature. They compose reusable components from components/ with feature‑specific data and behavior.
Example: projects/components/ProjectCard.tsx might use a generic Card from components/ui and display project data fetched by a hook.

hooks/: Custom hooks that encapsulate data fetching and mutation logic for that feature (using TanStack Query).
Example: projects/hooks/useProjects.ts fetches the list of projects for the current workspace.

types.ts: TypeScript types specific to that feature.

Key rule: A component in features/ should never be imported outside its own feature folder. If you find yourself needing to import a feature component elsewhere, it either belongs in components/ or you need to rethink the architecture.

## 🧭 Sidebar Navigation Groups

```
┌─────────────────────────────────┐
│  🌲 GeoTalos                 │  ← Logo (TopNav — fixed top bar)
│  [Org Switcher ▼]  [Avatar]    │
├─────────────────────────────────┤
│  ─── EXPLORE ───                │
│  🏠  Dashboard                  │
│  🗺  Map Explorer               │  ← Primary view
│                                 │
│  ─── DATA ─────                 │
│  📁  Projects                   │
│  🛰  Datasets                   │
│  📐  Annotation Schemas         │
│  🏷  Annotation Sets            │
│                                 │
│  ─── INTELLIGENCE ─             │
│  🤖  AI Models                  │
│  ⚡  Inference                  │
│  🔔  Automations       [2]      │  ← Badge: scheduled runs due soon
│                                 │
│  ─── OPERATIONS ─               │
│  ⚙  Jobs               [1]     │  ← Badge: running jobs
│  ⚙  Settings                   │
└─────────────────────────────────┘
```

**Badge logic:**
- **Automations badge**: number of automations that are due to run in the next hour.
- **Jobs badge**: `jobStore.activeJobIds.length` (running jobs).

---

## 🔐 Clerk v7 API Patterns

```ts
// Middleware (src/middleware.ts)
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
const isPublicRoute = createRouteMatcher(['/', '/sign-in(.*)', '/sign-up(.*)', '/select-org(.*)']);
export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) await auth.protect();
});

// Server component auth check
import { auth } from '@clerk/nextjs/server';
const { userId, orgId } = await auth();

// Clerk components
import { SignIn, SignUp, OrganizationSwitcher, OrganizationList, UserButton } from '@clerk/nextjs';
```

---

## 🌐 API Client & Query Keys

### HTTP Client (`src/lib/api/client.ts`)

```ts
import ky from 'ky';

const apiClient = ky.create({
  prefixUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
  hooks: {
    beforeRequest: [
      async (request) => {
        const token = await window.Clerk?.session?.getToken();
        if (token) request.headers.set('Authorization', `Bearer ${token}`);
      },
    ],
  },
});
```

### Centralised Query Keys (`src/lib/query-keys.ts`)

```ts
export const qk = {
  workspaces: {
    all: ['workspaces'] as const,
    detail: (id: string) => [...qk.workspaces.all, id] as const,
    projects: (workspaceId: string) => [...qk.workspaces.detail(workspaceId), 'projects'] as const,
  },
  projects: {
    detail: (id: string) => ['projects', id] as const,
    maps: (projectId: string) => [...qk.projects.detail(projectId), 'maps'] as const,
  },
  maps: {
    detail: (id: string) => ['maps', id] as const,
    layers: (mapId: string) => [...qk.maps.detail(mapId), 'layers'] as const,
  },
  datasets: {
    all: ['datasets'] as const,
    detail: (id: string) => ['datasets', id] as const,
    items: (datasetId: string) => ['datasets', datasetId, 'items'] as const,
  },
  annotationSchemas: {
    all: ['annotation-schemas'] as const,
    detail: (id: string) => ['annotation-schemas', id] as const,
    classes: (schemaId: string) => ['annotation-schemas', schemaId, 'classes'] as const,
  },
  annotationSets: {
    all: ['annotation-sets'] as const,
    detail: (id: string) => ['annotation-sets', id] as const,
    annotations: (setId: string) => ['annotation-sets', setId, 'annotations'] as const,
  },
  annotations: {
    detail: (id: string) => ['annotations', id] as const,
  },
  models: {
    all: ['ai-models'] as const,
    detail: (id: string) => ['ai-models', id] as const,
  },
  jobs: {
    all: ['jobs'] as const,
    detail: (id: string) => ['jobs', id] as const,
    outputs: (jobId: string) => ['jobs', jobId, 'outputs'] as const,
  },
  automations: {
    all: ['automations'] as const,
    detail: (id: string) => ['automations', id] as const,
    runs: (automationId: string) => ['automations', automationId, 'runs'] as const,
  },
};
```

---

## ⚡ Job Polling Pattern

All long‑running operations return `202 { job_id }`. Pattern:

```ts
// Mutation fires → addJob → toast polling
const mutation = useMutation({
  mutationFn: api.annotationSets.bulkImport,
  onSuccess: ({ job_id }) => {
    jobStore.addJob(job_id);
    toast.loading('Import started...', { id: job_id });
  },
});

// useJobPolling — refetchInterval while running
useQuery({
  queryKey: qk.jobs.detail(jobId),
  queryFn: () => api.jobs.getJob(jobId),
  refetchInterval: (data) =>
    ['running', 'queued', 'pending'].includes(data?.status ?? '') ? 3000 : false,
});
```

---

## 🗺️ Leaflet Map – Dynamic Import (no SSR)

```ts
const MapContainer = dynamic(() => import('@/components/map/MapContainer'), { ssr: false });
```

---

## 📐 Zod v4 Note

Zod 4 (`^4.3.6`) has breaking changes from v3. Key differences:
- `z.object({}).parse()` unchanged, but some inference types differ.
- `z.string().email()` still works, but error messages changed.
- Always use `import { z } from 'zod'` — no named type imports needed.

---

## 🌍 Environment Variables

```bash
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/select-org
CLERK_WEBHOOK_SECRET=whsec_...

# Backend
NEXT_PUBLIC_API_URL=http://localhost:8011/api/v1
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_TITILER_TILE_FORMAT=webp
NEXT_PUBLIC_TITILER_RESAMPLING=bilinear

# Map defaults
NEXT_PUBLIC_MAP_DEFAULT_CENTER_LAT=-3.4653
NEXT_PUBLIC_MAP_DEFAULT_CENTER_LNG=-62.2159
NEXT_PUBLIC_MAP_DEFAULT_ZOOM=5
```

---

## ✅ Summary

This frontend architecture is fully aligned with the backend schema. It provides a scalable, type‑safe, and map‑centric foundation that supports all planned use cases: manual annotation, AI inference, bulk operations, automations, and real‑time job monitoring. The folder structure encourages feature‑based development, and the chosen libraries are battle‑tested for geospatial applications.

The theming system is centralized via CSS variables and Tailwind, allowing global brand changes with minimal effort.