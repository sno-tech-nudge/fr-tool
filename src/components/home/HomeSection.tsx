/**
 * A titled block of the home page: heading and an optional action on one line,
 * with the content full width beneath. `micro` gives the small tracked label
 * the news strip uses instead of a full heading.
 */
export function HomeSection({
  title, meta, sub, action, micro, children,
}: {
  title: string
  /** Small figure beside the title, e.g. an unread count. */
  meta?: React.ReactNode
  sub?: React.ReactNode
  action?: React.ReactNode
  micro?: boolean
  children: React.ReactNode
}) {
  return (
    <section className="homesec" aria-label={title}>
      <div className="homesec__head">
        <div>
          {/* A div, not an h2: base.css restyles bare headings globally. */}
          <div role="heading" aria-level={2} className={micro ? 'tn-micro' : 'homesec__title'}>
            {title}{meta ? <> {meta}</> : null}
          </div>
          {sub ? <p className="homesec__sub">{sub}</p> : null}
        </div>
        {action ? <div className="homesec__action">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}
