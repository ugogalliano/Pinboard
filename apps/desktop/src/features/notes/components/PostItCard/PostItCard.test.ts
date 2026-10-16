import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import PostItCard from './PostItCard.vue'
import type { NoteDto } from '@/shared/types/api'

function note(overrides: Partial<NoteDto> = {}): NoteDto {
  return {
    id: 'n1',
    boardId: 'b1',
    createdBy: 'u1',
    content: 'Buy milk',
    color: 'note-teal',
    positionX: 40,
    positionY: 80,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('PostItCard', () => {
  it('renders content as TEXT — markup in the content cannot inject HTML', () => {
    const wrapper = mount(PostItCard, {
      props: { note: note({ content: '<img src=x onerror=alert(1)>' }) },
    })

    // The literal text appears, and no element was parsed from it.
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('positions from positionX/Y and paints the palette hex via inline style', () => {
    const wrapper = mount(PostItCard, { props: { note: note() } })

    const style = wrapper.find('[data-testid="post-it-card"]').attributes('style')!
    expect(style).toContain('left: 40px')
    expect(style).toContain('top: 80px')
    expect(style).toContain('rgb(160, 238, 228)') // NOTE_COLORS['note-teal']
  })

  it('falls back to the default hex for an unknown legacy color token', () => {
    const wrapper = mount(PostItCard, { props: { note: note({ color: 'neon' }) } })

    expect(wrapper.find('[data-testid="post-it-card"]').attributes('style')).toContain(
      'rgb(252, 242, 146)', // '#fcf292'
    )
  })

  it('emits edit on double-click and delete on the affordance, both with the note id', async () => {
    const wrapper = mount(PostItCard, { props: { note: note({ id: 'n7' }) } })

    await wrapper.find('[data-testid="post-it-card"]').trigger('dblclick')
    await wrapper.find('[data-testid="post-it-card-delete"]').trigger('click')

    expect(wrapper.emitted('edit')![0]).toEqual(['n7'])
    expect(wrapper.emitted('delete')![0]).toEqual(['n7'])
  })

  it('hides the delete affordance while the note is being edited', () => {
    const wrapper = mount(PostItCard, { props: { note: note(), editing: true } })

    expect(wrapper.find('[data-testid="post-it-card-delete"]').exists()).toBe(false)
  })

  it('emits pointerdown-drag with the note id AND the pointer event', () => {
    const wrapper = mount(PostItCard, { props: { note: note({ id: 'n7' }) } })

    wrapper
      .find('[data-testid="post-it-card"]')
      .element.dispatchEvent(new MouseEvent('pointerdown', { clientX: 12, clientY: 24 }))

    const emitted = wrapper.emitted('pointerdown-drag')
    expect(emitted).toHaveLength(1)
    const payload = emitted![0]![0] as { noteId: string; event: MouseEvent }
    // Id rides the payload (like edit/delete) so the canvas binds a stable
    // method ref — no per-card closure in its template.
    expect(payload.noteId).toBe('n7')
    expect(payload.event.clientX).toBe(12)
    expect(payload.event.clientY).toBe(24)
  })

  it('suppresses edit, delete, and drag affordances and events when read-only', async () => {
    const wrapper = mount(PostItCard, { props: { note: note(), readOnly: true } })
    const card = wrapper.find('[data-testid="post-it-card"]')

    expect(wrapper.find('[data-testid="post-it-card-delete"]').exists()).toBe(false)
    expect(card.classes()).toContain('cursor-default')
    await card.trigger('dblclick')
    card.element.dispatchEvent(new MouseEvent('pointerdown', { clientX: 12, clientY: 24 }))

    expect(wrapper.emitted('edit')).toBeUndefined()
    expect(wrapper.emitted('delete')).toBeUndefined()
    expect(wrapper.emitted('pointerdown-drag')).toBeUndefined()
  })

  it('applies a non-zero offset as transform and zero offsets render none', () => {
    // The canvas gates WHICH card receives a non-zero offset (live drag delta
    // or retained pending-visual); the card simply paints any non-zero offset.
    const idle = mount(PostItCard, { props: { note: note() } })
    expect(idle.find('[data-testid="post-it-card"]').attributes('style')).not.toContain('translate3d')

    const offset = mount(PostItCard, { props: { note: note(), offsetX: 30, offsetY: 5 } })
    expect(offset.find('[data-testid="post-it-card"]').attributes('style')).toContain(
      'translate3d(30px, 5px, 0)',
    )
  })

  it('scopes the grab cursor and compositor hints to the dragging card', () => {
    const idle = mount(PostItCard, { props: { note: note(), dragging: false } })
    expect(idle.find('[data-testid="post-it-card"]').classes()).not.toContain('will-change-transform')

    const dragging = mount(PostItCard, {
      props: { note: note(), dragging: true, offsetX: 30, offsetY: 5 },
    })
    const card = dragging.find('[data-testid="post-it-card"]')
    expect(card.attributes('style')).toContain('translate3d(30px, 5px, 0)')
    // Compositor hygiene is gated on the dragged card alone.
    expect(card.classes()).toContain('will-change-transform')
    expect(card.classes()).toContain('touch-none')
    expect(card.attributes('draggable')).toBe('false')
  })
})
