# GeoTALOS Frontend

A modern, responsive Next.js frontend for the geospatial image annotation platform with a bronze theme (#8c6d2c).

## Features

- ✅ User Authentication (Login/Register)
- ✅ Project Management
- ✅ Image Upload & Management
- ✅ Annotation Interface
- ✅ ML Model Predictions
- ✅ Responsive Design
- ✅ Beautiful Bronze Theme (#8c6d2c)
- ✅ Type-Safe with TypeScript
- ✅ State Management with Zustand
- ✅ Modern UI Components

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **HTTP Client**: Axios
- **Icons**: Lucide React
- **File Upload**: React Dropzone
- **Geospatial**: OpenLayers ready

## Color Theme

Primary Bronze: `#8c6d2c`
- Light: `#c19b5c`
- Dark: `#695221`

Full palette available in `tailwind.config.js`

## Quick Start

### 1. Install Dependencies

```bash
npm install
# or
yarn install
# or
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
```

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Project Structure

```
annotation-frontend/
├── app/                      # Next.js 14 App Router
│   ├── login/                # Login page
│   ├── register/             # Registration page
│   ├── dashboard/            # Dashboard
│   ├── projects/             # Projects list & detail
│   ├── annotate/             # Annotation interface
│   ├── models/               # ML models page
│   ├── layout.tsx            # Root layout
│   ├── page.tsx              # Home (redirect)
│   └── globals.css           # Global styles
├── components/
│   ├── layout/
│   │   ├── Navbar.tsx        # Navigation bar
│   │   └── Layout.tsx        # Page wrapper
│   └── ui/                   # Reusable UI components
│       ├── Button.tsx
│       ├── Input.tsx
│       ├── Card.tsx
│       └── Modal.tsx
├── lib/
│   ├── api-client.ts         # API wrapper
│   ├── store.ts              # Zustand state
│   └── utils.ts              # Utility functions
├── types/
│   └── index.ts              # TypeScript types
└── public/                   # Static assets
```

## Pages

### Authentication
- `/login` - User login
- `/register` - New user registration

### Main App
- `/dashboard` - Overview with stats
- `/projects` - Project list
- `/projects/[id]` - Project detail with images
- `/annotate` - Annotation interface
- `/models` - ML model management

## Components

### UI Components

**Button**
```tsx
<Button variant="primary" size="md" onClick={handleClick}>
  Click Me
</Button>
```

**Input**
```tsx
<Input 
  label="Email" 
  type="email" 
  value={email}
  onChange={(e) => setEmail(e.target.value)}
/>
```

**Card**
```tsx
<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
  </CardHeader>
  <CardContent>
    Content here
  </CardContent>
</Card>
```

**Modal**
```tsx
<Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Modal Title">
  Content here
</Modal>
```

### Layout Components

**Layout** - Wraps pages with navigation
```tsx
<Layout requireAuth={true}>
  <YourContent />
</Layout>
```

**Navbar** - Top navigation with user menu

## State Management

Uses Zustand for global state:

```tsx
import { useStore } from '@/lib/store';

function MyComponent() {
  const { user, projects, fetchProjects } = useStore();
  
  useEffect(() => {
    fetchProjects();
  }, []);
  
  return <div>{projects.length} projects</div>;
}
```

### Available State

- `user` - Current user
- `projects` - All projects
- `currentProject` - Selected project
- `images` - All images
- `currentImage` - Selected image
- `annotations` - All annotations
- `models` - ML models
- `predictions` - Predictions

## API Client

Centralized API client with auth:

```tsx
import { apiClient } from '@/lib/api-client';

// Auth
await apiClient.login(email, password);
await apiClient.register(email, password);
const user = await apiClient.getCurrentUser();

// Projects
const projects = await apiClient.getProjects();
const project = await apiClient.createProject({ name, description });

// Images
const images = await apiClient.getImages(projectId);
await apiClient.uploadImage(file, projectId);

// Annotations
const annotations = await apiClient.getAnnotations(imageId);
await apiClient.createAnnotation(data);

// Models & Predictions
const models = await apiClient.getModels();
await apiClient.createPrediction({ image_id, model_id });
```

## Styling

### Tailwind Classes

Custom classes available:
- `.container-custom` - Max-width container with padding
- `.page-header` - Page header spacing
- `.page-title` - Page title styling
- `.page-description` - Description text

### Color Palette

```css
/* Primary (Bronze) */
bg-primary-50    /* Lightest */
bg-primary-100
bg-primary-200
bg-primary-300
bg-primary-400
bg-primary-500   /* Base #8c6d2c */
bg-primary-600
bg-primary-700
bg-primary-800
bg-primary-900   /* Darkest */

/* Shortcuts */
bg-bronze-light  /* #c19b5c */
bg-bronze        /* #8c6d2c */
bg-bronze-dark   /* #695221 */
```

## TypeScript Types

All types defined in `types/index.ts`:

```typescript
interface User {
  id: number;
  email: string;
  full_name?: string;
  is_active: boolean;
  created_at: string;
}

interface Project {
  id: number;
  name: string;
  description?: string;
  image_count?: number;
  annotation_count?: number;
}

// ... and more
```

## Development

### Running Locally

```bash
# Development
npm run dev

# Build
npm run build

# Start production
npm run start

# Lint
npm run lint
```

### Adding New Pages

1. Create file in `app/` directory
2. Use `'use client'` for client components
3. Wrap in `<Layout>` component
4. Add navigation link in Navbar

### Adding New Components

1. Create in `components/ui/` or `components/layout/`
2. Export default
3. Use TypeScript types
4. Follow existing patterns

## Environment Variables

```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
NEXT_PUBLIC_APP_NAME=Annotation Tool
```

## Integration with Backend

### Authentication Flow

1. User logs in via `/login`
2. Token stored in localStorage
3. API client adds token to all requests
4. Auto-redirect on 401 responses

### API Endpoints

All endpoints from backend are wrapped:
- Auth: `/auth/*`
- Projects: `/projects/*`
- Images: `/images/*`
- Annotations: `/annotations/*`
- Models: `/models/*`
- Predictions: `/predictions/*`

## Customization

### Changing Colors

Edit `tailwind.config.js`:

```js
colors: {
  primary: {
    500: '#YOUR_COLOR',
    // ... other shades
  }
}
```

### Adding Features

1. Create new page in `app/`
2. Add API methods in `api-client.ts`
3. Add state in `store.ts` if needed
4. Create UI components
5. Add navigation link

## Deployment

### Vercel (Recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Production
vercel --prod
```

### Docker

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
```

### Environment Variables

Set in deployment platform:
- `NEXT_PUBLIC_API_URL` - Backend API URL

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Performance

- Server-side rendering (SSR)
- Automatic code splitting
- Image optimization ready
- Lazy loading components

## Accessibility

- Semantic HTML
- ARIA labels
- Keyboard navigation
- Screen reader friendly

## Security

- JWT token storage
- XSS protection
- CSRF protection (via SameSite cookies)
- API client auth interceptor

## Future Enhancements

### Planned Features

- [ ] Real-time collaboration (WebSockets)
- [ ] Advanced annotation tools (OpenLayers integration)
- [ ] Export annotations (GeoJSON, COCO format)
- [ ] Keyboard shortcuts
- [ ] Dark mode
- [ ] Multi-language support
- [ ] Annotation history/versioning
- [ ] Team management
- [ ] Advanced filtering
- [ ] Bulk operations

### Geospatial Integration

To add full map/annotation capabilities:

```bash
npm install ol @types/ol
```

Create map component:
```tsx
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';

// Initialize OpenLayers map
// Add drawing interactions
// Handle geometry creation
```

## Troubleshooting

### API Connection Issues

- Check `NEXT_PUBLIC_API_URL` in `.env.local`
- Ensure backend is running
- Check CORS configuration in backend

### Build Errors

```bash
# Clear cache
rm -rf .next
npm run dev
```

### Type Errors

```bash
# Regenerate TypeScript definitions
npm run build
```

## Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Test thoroughly
5. Submit pull request

## License

MIT License

## Support

For issues and questions:
- Check documentation
- Review code examples
- Test with backend API docs at `/docs`
