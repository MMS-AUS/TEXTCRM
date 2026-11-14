/** A record's primary email as a link, with its extra emails as small tag links beside it. */
export function EmailLinks({
  email,
  extraEmails,
}: {
  email: string | null;
  extraEmails: readonly string[];
}) {
  if (!email) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <a href={`mailto:${email}`} className="hover:text-accent-text hover:underline">
        {email}
      </a>
      {extraEmails.map((address) => (
        <a
          key={address}
          href={`mailto:${address}`}
          className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-fg-muted hover:text-accent-text"
        >
          {address}
        </a>
      ))}
    </span>
  );
}
