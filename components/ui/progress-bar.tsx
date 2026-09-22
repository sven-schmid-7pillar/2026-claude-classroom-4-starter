/**
 * A share of something done, as a bar. Graphite on the inset grey rather than
 * blue: nothing here is clickable, and blue is kept for what is. Square, with
 * a hairline edge so the empty track still reads on a white panel.
 *
 * `value` is a percentage; anything outside 0–100, or not a number at all
 * (an unresolved binding arrives as `undefined`), is clamped rather than drawn
 * past the track. The figure itself is left to the text beside the bar, so
 * the bar is never the only way to read it.
 */
export function ProgressBar({
  value,
  label,
}: {
  value: number | undefined;
  label: string;
}) {
  const percent =
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(100, Math.max(0, value))
      : 0;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-2 w-full border border-edge bg-raised"
    >
      <div className="h-full bg-ink-soft" style={{ width: `${percent}%` }} />
    </div>
  );
}
