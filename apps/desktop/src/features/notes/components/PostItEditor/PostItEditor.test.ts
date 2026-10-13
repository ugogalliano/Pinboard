import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import PostItEditor from './PostItEditor.vue'

// Zod validation through toTypedSchema crosses macrotask boundaries, so a
// single flushPromises() is not enough (same settle() idiom as the boards
// component tests).
async function settle(): Promise<void> {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 50))
}

// The editor is a DUMB component: it validates and emits — the network lives
// in the parent (NoteCanvas). "Zero requests" is therefore asserted as "zero
// save emits"; the real network paths are covered by NoteCanvas.test.ts.
describe('PostItEditor', () => {
  function mountEditor(props: Partial<Record<string, unknown>> = {}) {
    return mount(PostItEditor, {
      props: {
        initialContent: '',
        initialColor: 'note-yellow',
        positionX: 10,
        positionY: 20,
        testIdPrefix: 'editor',
        ...props,
      },
    })
  }

  function textarea(wrapper: ReturnType<typeof mountEditor>) {
    return wrapper.find('[data-testid="editor-content"]')
  }

  async function pressEnter(wrapper: ReturnType<typeof mountEditor>): Promise<void> {
    await textarea(wrapper).trigger('keydown', { key: 'Enter' })
    await settle()
  }

  it('rejects content over 1000 characters inline without emitting save', async () => {
    const wrapper = mountEditor()

    await textarea(wrapper).setValue('x'.repeat(1001))
    await pressEnter(wrapper)

    expect(wrapper.emitted('save')).toBeUndefined()
    const error = wrapper.find('[data-testid="editor-content-error"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain('at most 1000 characters')
  })

  it('rejects empty content and emits the Zod required message', async () => {
    const wrapper = mountEditor()

    await pressEnter(wrapper)

    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.find('[data-testid="editor-content-error"]').text()).toContain(
      'Note content is required',
    )
  })

  it('saves exactly ONCE per Enter press — repeated Enters do not duplicate', async () => {
    const wrapper = mountEditor()

    await textarea(wrapper).setValue('Buy milk')
    await pressEnter(wrapper)
    await pressEnter(wrapper)

    const saves = wrapper.emitted('save')
    expect(saves).toHaveLength(1)
    expect(saves![0]![0]).toEqual({ content: 'Buy milk', color: 'note-yellow' })
  })

  it('Shift+Enter inserts a newline instead of saving', async () => {
    const wrapper = mountEditor()

    await textarea(wrapper).setValue('Buy milk')
    await textarea(wrapper).trigger('keydown', { key: 'Enter', shiftKey: true })
    await settle()

    expect(wrapper.emitted('save')).toBeUndefined()
  })

  it('blur + Enter on the same logical save submit exactly one save', async () => {
    const wrapper = mountEditor()

    await textarea(wrapper).setValue('Buy milk')
    await pressEnter(wrapper)
    await textarea(wrapper).trigger('blur')
    await settle()

    expect(wrapper.emitted('save')).toHaveLength(1)
  })

  it('blur submits on its own (save-on-blur contract)', async () => {
    const wrapper = mountEditor()

    await textarea(wrapper).setValue('Buy milk')
    await textarea(wrapper).trigger('blur')
    await settle()

    expect(wrapper.emitted('save')).toHaveLength(1)
  })

  it('Escape emits cancel with zero saves — and a trailing blur cannot submit', async () => {
    const wrapper = mountEditor()

    await textarea(wrapper).setValue('Buy milk')
    await textarea(wrapper).trigger('keydown', { key: 'Escape' })
    await textarea(wrapper).trigger('blur')
    await settle()

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('save')).toBeUndefined()
  })

  it('disables both buttons while saving', () => {
    const wrapper = mountEditor({ saving: true })

    expect(wrapper.find('[data-testid="editor-save"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="editor-cancel"]').attributes('disabled')).toBeDefined()
  })

  it('renders the server 400 detail as a form-level alert', () => {
    const wrapper = mountEditor({ serverError: 'Invalid input: content rejected' })

    const alert = wrapper.find('[role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toBe('Invalid input: content rejected')
  })

  it('the Cancel button emits cancel with zero saves', async () => {
    const wrapper = mountEditor()

    await textarea(wrapper).setValue('Buy milk')
    await wrapper.find('[data-testid="editor-cancel"]').trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('save')).toBeUndefined()
  })
})
