import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, ref } from 'vue'

import { useBoard } from './useBoard'
import { API_URLS } from '@/shared/constants/urls'
import { server } from '../../../../test/msw/server'
import { requestLog } from '../../../../test/msw/requests'
import type { BoardDto } from '@/shared/types/api'

function board(id: string): BoardDto {
  return {
    id,
    name: id,
    createdBy: 'u1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    memberCount: 1,
  }
}

async function settle(): Promise<void> {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 50))
}

describe('useBoard', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    setActivePinia(createPinia())
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
  })

  function mountBoard(boardId: string | undefined) {
    const param = ref(boardId)
    let result!: ReturnType<typeof useBoard>
    const Harness = defineComponent({
      setup() {
        result = useBoard(param)
        return () => h('div')
      },
    })
    const wrapper = mount(Harness, {
      global: { plugins: [[VueQueryPlugin, { queryClient }]] },
    })
    return { wrapper, result, param }
  }

  it('fetches the board by id', async () => {
    server.use(http.get(API_URLS.boards.detail('b1'), () => HttpResponse.json(board('b1'))))

    const { result } = mountBoard('b1')
    await settle()

    expect(requestLog.map((entry) => entry.url)).toEqual([API_URLS.boards.detail('b1')])
    expect(result.data.value?.name).toBe('b1')
  })

  it('stays disabled (and pending) without an id — no request is issued', async () => {
    const { result } = mountBoard(undefined)
    await settle()

    expect(requestLog).toHaveLength(0)
    expect(result.isPending.value).toBe(true)
  })

  it('normalizes an array-shaped route param and switches boards when the id changes', async () => {
    server.use(
      http.get('/api/boards/:id', ({ params }) => HttpResponse.json(board(params.id as string))),
    )

    const { result, param } = mountBoard('b1')
    await settle()
    expect(requestLog.map((entry) => entry.url)).toEqual([API_URLS.boards.detail('b1')])

    param.value = 'b2'
    await settle()

    expect(requestLog.map((entry) => entry.url)).toEqual([
      API_URLS.boards.detail('b1'),
      API_URLS.boards.detail('b2'),
    ])
    expect(result.data.value?.id).toBe('b2')
  })

  it('holds the previous board in data while a new one loads (keepPreviousData)', async () => {
    let calls = 0
    let releaseSecond!: () => void
    server.use(
      http.get('/api/boards/:id', () => {
        calls += 1
        // First board resolves immediately; the second fetch hangs until the
        // test releases it, so the "loading a new board" window is observable.
        if (calls === 1) return HttpResponse.json(board('b1'))
        return new Promise<Response>((resolve) => {
          releaseSecond = () => resolve(HttpResponse.json(board('b2')))
        })
      }),
    )

    const { result, param } = mountBoard('b1')
    await settle()
    expect(result.data.value?.id).toBe('b1')

    param.value = 'b2'
    // Let vue-query issue the fetch for the new key (no resolve yet).
    for (let i = 0; i < 10 && calls < 2; i += 1) {
      await flushPromises()
    }
    expect(calls).toBe(2)

    // keepPreviousData: the previous board stays available (isPending stays
    // true — that is why BoardHeader gates its spinner on `!board` too).
    expect(result.isFetching.value).toBe(true)
    expect(result.data.value?.id).toBe('b1')

    releaseSecond()
    await settle()

    expect(result.data.value?.id).toBe('b2')
    expect(result.isFetching.value).toBe(false)
  })

  it.each([
    ['404', 404],
    ['403', 403],
  ])('reports an error state for %s (deep-linking a foreign board)', async (_label, status) => {
    server.use(
      http.get(API_URLS.boards.detail('b1'), () =>
        HttpResponse.json({ status, detail: 'nope' }, { status }),
      ),
    )

    const { result } = mountBoard('b1')
    await settle()

    expect(result.isError.value).toBe(true)
  })

  it('accepts an array-shaped route param (vue-router param type)', async () => {
    server.use(http.get(API_URLS.boards.detail('b1'), () => HttpResponse.json(board('b1'))))

    // `string | string[]` is what vue-router hands over; the composable
    // normalizes it once instead of every call site doing it.
    const param = ref<string | string[]>(['b1'])
    const Harness = defineComponent({
      setup() {
        const { isPending } = useBoard(param)
        return () => h('div', isPending.value ? 'pending' : 'ready')
      },
    })
    const wrapper = mount(Harness, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } })
    await settle()

    expect(requestLog[0]!.url).toBe(API_URLS.boards.detail('b1'))
    expect(wrapper.text()).toBe('ready')
    expect(wrapper.find('div').exists()).toBe(true)
  })
})
