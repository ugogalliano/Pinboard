import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, ref } from 'vue'

import { useBoard } from './useBoard'

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

function jsonResponse(status: number, body: unknown): Response {
  const text = body === undefined ? '' : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => (text === '' ? undefined : JSON.parse(text)),
  } as unknown as Response
}

function board(id: string) {
  return {
    id,
    name: id,
    createdBy: 'u1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
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

  afterEach(() => {
    vi.unstubAllGlobals()
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
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(200, board('b1')))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = mountBoard('b1')
    await settle()

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['/api/boards/b1'])
    expect(result.data.value?.name).toBe('b1')
  })

  it('stays disabled (and pending) without an id — no request is issued', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(200, board('b1')))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = mountBoard(undefined)
    await settle()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.isPending.value).toBe(true)
  })

  it('normalizes an array-shaped route param and switches boards when the id changes', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async (url) => {
        urls.push(String(url))
        return jsonResponse(200, board(String(url).replace('/api/boards/', '')))
      }),
    )

    const { result, param } = mountBoard('b1')
    await settle()
    expect(urls).toEqual(['/api/boards/b1'])

    param.value = 'b2'
    await settle()

    expect(urls).toEqual(['/api/boards/b1', '/api/boards/b2'])
    expect(result.data.value?.id).toBe('b2')
  })

  it('holds the previous board in data while a new one loads (keepPreviousData)', async () => {
    let calls = 0
    let resolveSecond!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async () => {
        calls += 1
        // First board resolves immediately; the second fetch hangs until the
        // test releases it, so the "loading a new board" window is observable.
        if (calls === 1) return jsonResponse(200, board('b1'))
        return new Promise<Response>((resolve) => {
          resolveSecond = resolve
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

    resolveSecond(jsonResponse(200, board('b2')))
    await settle()

    expect(result.data.value?.id).toBe('b2')
    expect(result.isFetching.value).toBe(false)
  })

  it.each([
    ['404', 404],
    ['403', 403],
  ])('reports an error state for %s (deep-linking a foreign board)', async (_label, status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchImpl>(async () => jsonResponse(status, { status, detail: 'nope' })),
    )

    const { result } = mountBoard('b1')
    await settle()

    expect(result.isError.value).toBe(true)
  })

  it('accepts an array-shaped route param (vue-router param type)', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(200, board('b1')))
    vi.stubGlobal('fetch', fetchMock)

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

    expect(String(fetchMock.mock.calls[0]![0])).toBe('/api/boards/b1')
    expect(wrapper.text()).toBe('ready')
    expect(wrapper.find('div').exists()).toBe(true)
  })
})
