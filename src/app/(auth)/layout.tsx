import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-primary-50/40 flex flex-col">
      {/* Top bar */}
      <div className="px-6 py-4">
        <Link href="/" className="inline-flex items-center gap-2.5 group">
          <img
            src="/GeoTalos_mark.png"
            alt="GeoTalos"
            className="h-9 w-auto object-contain select-none"
          />
          <div className="leading-tight">
            <span className="text-base font-bold text-primary-600 group-hover:text-primary-700 transition-colors">
              GeoTALOS
            </span>
            <p className="text-[10px] text-gray-400 leading-none">Geoscience Platform</p>
          </div>
        </Link>
      </div>

      {/* Centered content */}
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          {children}
        </div>
      </div>

      {/* Footer */}
      <div className="py-4 text-center text-xs text-gray-400">
        &copy; {new Date().getFullYear()} GeoTALOS
      </div>
    </div>
  );
}
