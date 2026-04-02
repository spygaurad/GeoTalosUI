import type { ReactNode } from 'react';

/**
 * Pipeline builder layout — breaks out of the workspace layout's flex container
 * to render full-screen (no AppSidebar visible). Uses fixed positioning to overlay
 * the entire viewport.
 */
export default function PipelineBuilderLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0"
      style={{ zIndex: 50, backgroundColor: '#f5ede0' }}
    >
      {children}
    </div>
  );
}
