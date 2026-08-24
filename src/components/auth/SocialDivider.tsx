/** "or continue with" divider between the credentials form and social auth */
export function SocialDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-dark-200 dark:bg-dark-700" />
      <span className="text-xs font-medium uppercase tracking-wider text-dark-400">{label}</span>
      <span className="h-px flex-1 bg-dark-200 dark:bg-dark-700" />
    </div>
  );
}
