import { useEffect, useState, type ReactNode } from 'react';
export function InboxGroup({
  title,
  count,
  children,
  initiallyOpen = false,
  forceOpen = false,
  description,
}: {
  title: string;
  count: number | string;
  children: ReactNode;
  initiallyOpen?: boolean;
  forceOpen?: boolean;
  description?: string;
}) {
  const [expanded, setExpanded] = useState(initiallyOpen);
  useEffect(() => {
    if (forceOpen) setExpanded(true);
  }, [forceOpen]);
  return (
    <details className="inbox-group" open={expanded}>
      <summary
        onClick={(event) => {
          event.preventDefault();
          setExpanded(!expanded);
        }}
      >
        <span>
          <strong>{title}</strong>
          {description && <small>{description}</small>}
        </span>
        <span className="group-count">{count}</span>
      </summary>
      <div className="inbox-group-content">{children}</div>
    </details>
  );
}
