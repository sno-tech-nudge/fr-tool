import { useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { Link } from '@tanstack/react-router'
import { formatMoney } from '../../lib/format'
import type { Stage } from '../../hooks/usePipelineStages'
import type { Opportunity } from './OpportunityForm'

export type BoardCard = Opportunity & {
  fr_organisations: { id: string; name: string } | null
}

/* ---------- card ---------- */

function Card({ card, dragging = false }: { card: BoardCard; dragging?: boolean }) {
  return (
    <article className={`kcard${dragging ? ' kcard--dragging' : ''}`}>
      <Link
        to="/opportunities/$id"
        params={{ id: card.id }}
        className="kcard__name"
        onClick={(e) => e.stopPropagation()}
      >
        {card.name}
      </Link>
      <div className="kcard__org">{card.fr_organisations?.name ?? '—'}</div>
      <div className="kcard__foot">
        <span className="tn-num kcard__amount">{formatMoney(card.amount_inr)}</span>
        {card.deal_category ? <span className="kcard__tag">{card.deal_category}</span> : null}
      </div>
    </article>
  )
}

function DraggableCard({ card }: { card: BoardCard }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.4 : 1, cursor: 'grab', touchAction: 'none' }}
    >
      <Card card={card} />
    </div>
  )
}

/* ---------- column ---------- */

function Column({
  stage, cards,
}: {
  stage: Stage
  cards: BoardCard[]
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const total = cards.reduce((sum, c) => sum + (c.amount_inr ?? 0), 0)

  return (
    <section className="kcol" ref={setNodeRef} data-over={isOver}>
      <header className="kcol__head">
        <span className="kcol__swatch" style={{ background: stage.color ?? 'var(--brown-500)' }} aria-hidden="true" />
        <span className="kcol__label">{stage.label}</span>
        <span className="kcol__count tn-num">{cards.length}</span>
      </header>
      <div className="kcol__total tn-num">{formatMoney(total)}</div>
      <div className="kcol__body">
        {cards.map((c) => <DraggableCard key={c.id} card={c} />)}
        {cards.length === 0 ? <p className="kcol__empty">—</p> : null}
      </div>
    </section>
  )
}

/* ---------- board ---------- */

export function KanbanBoard({
  stages, cards, onMove,
}: {
  stages: Stage[]
  cards: BoardCard[]
  /** Called with the card and its target stage; the page owns validation. */
  onMove: (card: BoardCard, toStage: Stage) => void
}) {
  const [activeId, setActiveId] = useState<string | null>(null)

  // A small activation distance keeps a click on the card's link from being
  // swallowed as the start of a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const byStage = useMemo(() => {
    const map = new Map<string, BoardCard[]>()
    for (const s of stages) map.set(s.id, [])
    for (const c of cards) map.get(c.stage_id)?.push(c)
    return map
  }, [stages, cards])

  const activeCard = activeId ? cards.find((c) => c.id === activeId) ?? null : null

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const card = cards.find((c) => c.id === String(active.id))
    const toStage = stages.find((s) => s.id === String(over.id))
    if (!card || !toStage || card.stage_id === toStage.id) return
    onMove(card, toStage)
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="kboard">
        {stages.map((s) => (
          <Column key={s.id} stage={s} cards={byStage.get(s.id) ?? []} />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeCard ? <Card card={activeCard} dragging /> : null}
      </DragOverlay>
    </DndContext>
  )
}
