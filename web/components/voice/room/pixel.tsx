// Stub: replaced by the drawn room at integration.
export function PixelGrid(props: {
  rows: string[];
  palette: Record<string, string>;
  cell: number;
  label?: string;
  className?: string;
}): React.JSX.Element {
  const width = (props.rows[0]?.length ?? 0) * props.cell;
  const height = props.rows.length * props.cell;
  return props.label
    ? <svg width={width} height={height} role="img" aria-label={props.label} className={props.className} />
    : <svg width={width} height={height} aria-hidden className={props.className} />;
}
