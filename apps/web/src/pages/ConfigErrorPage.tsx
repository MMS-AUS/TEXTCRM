/** Shown instead of the app when the Firebase web config in .env is missing. */
export function ConfigErrorPage({ missing }: { missing: string[] }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-8 text-sm">
        <h1 className="text-lg font-semibold text-red-700">Configuration missing</h1>
        <p className="mt-2 text-slate-600">
          Add these to the <code>.env</code> file in the repo root, then restart{' '}
          <code>npm run dev</code>:
        </p>
        <ul className="mt-3 list-inside list-disc font-mono text-slate-800">
          {missing.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </div>
    </main>
  );
}
