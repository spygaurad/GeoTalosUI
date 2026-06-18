# GeoTalos — Frontend

![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js)
![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38b2ac?style=flat-square&logo=tailwindcss)
![Zustand](https://img.shields.io/badge/Zustand-4-43e8c9?style=flat-square)
![Leaflet](https://img.shields.io/badge/Leaflet-1.9-199900?style=flat-square&logo=leaflet)
![React Query](https://img.shields.io/badge/React%20Query-5-ff4154?style=flat-square)
![Clerk](https://img.shields.io/badge/Clerk-7-6c47ff?style=flat-square&logo=clerk)

Geospatial forest management platform. Discover satellite imagery, run AI models, review annotations, and automate monitoring workflows on an interactive map.

## Features

🗺️ **Map-Centric Workspace** — Explore imagery, define study areas, and manage geospatial data  
🤖 **AI Integration** — Register models, run inference, review predictions as map annotations  
📍 **Annotation Tools** — Schema-driven labeling, multi-user review, version history  
⚙️ **Visual Automation** — Drag-and-drop pipeline builder for repeatable monitoring tasks  
🔄 **Job Monitoring** — Async processing with live progress tracking  
🏢 **Multi-Tenant** — Organization-based access, role-based permissions via Clerk  


## Quick Start

### Prerequisites
- Node.js 18+
- Backend: [GeoTalosProd](https://github.com/spygaurad/GeoTalosProd)

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment

```bash
cp .env.local.example .env.local
```

Configure `.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_key_here
```

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Backend Integration

GeoTalos Frontend communicates with the **FastAPI backend** at [GeoTalosProd](https://github.com/spygaurad/GeoTalosProd).

```bash
# Start backend (in separate terminal)
cd ../GeoTalosProd
docker-compose up
```

Ensure `NEXT_PUBLIC_API_URL` points to your backend instance.

## Development

```bash
npm run dev       # Start dev server
npm run build     # Build for production
npm run start     # Start production server
npm run lint      # Run ESLint
```

## Architecture

- **App Router** — Next.js 15 with server/client components
- **State** — Zustand stores for UI, TanStack Query for server state
- **Maps** — Leaflet + react-leaflet for geospatial visualization
- **Forms** — React Hook Form + Zod for validated input
- **Auth** — Clerk for multi-tenant identity & org management
- **Styling** — Tailwind CSS with golden brown theme (#8c6d2c)

## Key Routes

| Route | Purpose |
|-------|---------|
| `/sign-in`, `/sign-up` | Authentication |
| `/select-org` | Organization selection |
| `/workspace` | Main dashboard |
| `/workspace/[id]/projects` | Project management |
| `/workspace/[id]/projects/[id]/maps/[id]` | Map editor & annotation |
| `/workspace/[id]/projects/[id]/automations` | Pipeline builder |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Backend API endpoint |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk authentication key |


## Support

**Issues & Questions:** Open an issue on GitHub  
**Backend:** [GeoTalosProd](https://github.com/spygaurad/GeoTalosProd)  

## License

MIT
