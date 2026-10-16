import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'

import BoardCard from './BoardCard.vue'
import type { BoardDto } from '@/shared/types/api'

const BOARD: BoardDto = {
  id: 'b1',
  name: 'Product launch',
  createdBy: 'u1',
  createdAt: '2026-02-03T00:00:00Z',
  updatedAt: '2026-02-03T00:00:00Z',
  memberCount: 1,
}

async function makeStubRouter(): Promise<Router> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/boards/:boardId',
        name: 'board-canvas',
        component: { template: '<div>canvas</div>' },
      },
      { path: '/', component: { template: '<div>home</div>' } },
    ],
  })
  await router.push('/')
  await router.isReady()
  return router
}

describe('BoardCard', () => {
  it.each([
    { count: 0, variant: 'card' as const, label: '0 members' },
    { count: 1, variant: 'nav' as const, label: '1 member' },
    { count: 3, variant: 'card' as const, label: '3 members' },
    { count: 3, variant: 'nav' as const, label: '3 members' },
  ])('renders $label for the $variant variant', async ({ count, variant, label }) => {
    const router = await makeStubRouter()
    const wrapper = mount(BoardCard, {
      global: { plugins: [router] },
      props: { board: { ...BOARD, memberCount: count }, variant },
    })

    expect(wrapper.text()).toContain(label)
  })

  it('renders the board name as text and links to the board canvas', async () => {
    const router = await makeStubRouter()
    const wrapper = mount(BoardCard, { global: { plugins: [router] }, props: { board: BOARD } })

    expect(wrapper.text()).toContain('Product launch')
    // Board names are user content: interpolated text, never raw HTML.
    expect(wrapper.html()).not.toContain('<script')

    await wrapper.find('[data-testid="board-card"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/boards/b1')
    expect(router.currentRoute.value.name).toBe('board-canvas')
  })

  it('marks the card of the active board with aria-current="page"', async () => {
    const router = await makeStubRouter()
    await router.push('/boards/b1')

    const active = mount(BoardCard, { global: { plugins: [router] }, props: { board: BOARD } })
    expect(active.find('[data-testid="board-card"]').attributes('aria-current')).toBe('page')

    const other = mount(BoardCard, {
      global: { plugins: [router] },
      props: { board: { ...BOARD, id: 'b2', name: 'Other' } },
    })
    expect(other.find('[data-testid="board-card"]').attributes('aria-current')).toBeUndefined()
  })
})
