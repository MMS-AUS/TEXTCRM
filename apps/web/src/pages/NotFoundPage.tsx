import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { BrandMark } from '../components/BrandMark.tsx';
import { Button } from '../ui/index.ts';

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-center">
      <BrandMark />
      <div>
        <p className="text-sm font-semibold text-accent-text">404</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 max-w-sm text-sm text-fg-muted">
          The address may be mistyped, or the page has moved.
        </p>
      </div>
      <Button asChild variant="primary">
        <Link to="/dashboard">
          <ArrowLeft />
          Back to the dashboard
        </Link>
      </Button>
    </main>
  );
}
