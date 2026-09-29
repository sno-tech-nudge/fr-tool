/**
 * The shell every home card shares: a fixed-height card whose header and
 * footer stay put while the list between them scrolls. One height for all of
 * them keeps the grid even however much each card holds.
 */
export function HomeCard({
  title, meta, action, footer, children, label,
}: {
  title: string
  /** Small figure beside the title, e.g. an unread count. */
  meta?: React.ReactNode
  action?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
  label?: string
}) {
  return (
    <section className="card homecard" aria-label={label ?? title}>
      <div className="homecard__head">
        <span className="tn-micro">{title}{meta ? <> {meta}</> : null}</span>
        {action}
      </div>
      <div className="homecard__body">{children}</div>
      {footer ? <div className="homecard__foot">{footer}</div> : null}
    </section>
  )
}
