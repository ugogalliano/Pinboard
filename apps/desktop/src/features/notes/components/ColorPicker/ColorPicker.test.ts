import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import ColorPicker from './ColorPicker.vue'
import { NOTE_COLORS, NOTE_COLOR_NAMES } from '@/shared/constants/note-colors'

describe('ColorPicker', () => {
  function mountPicker(modelValue = 'note-yellow') {
    return mount(ColorPicker, { props: { modelValue } })
  }

  it('renders one swatch per palette entry', () => {
    const wrapper = mountPicker()

    const swatches = wrapper.findAll('[data-testid="color-swatch"]')
    expect(swatches).toHaveLength(NOTE_COLOR_NAMES.length)
    expect(NOTE_COLOR_NAMES).toHaveLength(8)
  })

  it('emits the palette TOKEN on click — never the hex', async () => {
    const wrapper = mountPicker()

    const teal = wrapper
      .findAll('[data-testid="color-swatch"]')
      .find((swatch) => swatch.attributes('aria-label') === 'note-teal')!
    await teal.trigger('click')

    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toHaveLength(1)
    expect(emitted![0]![0]).toBe('note-teal')
    expect(emitted![0]![0]).not.toBe(NOTE_COLORS['note-teal'])
  })

  it('marks the selected token with aria-pressed and paints swatches from the palette map', () => {
    const wrapper = mountPicker('note-teal')

    const swatches = wrapper.findAll('[data-testid="color-swatch"]')
    const pressed = swatches.filter((swatch) => swatch.attributes('aria-pressed') === 'true')
    expect(pressed).toHaveLength(1)
    expect(pressed[0]!.attributes('aria-label')).toBe('note-teal')

    // Inline :style from NOTE_COLORS — never dynamic bg-${color} classes.
    const yellow = swatches.find((swatch) => swatch.attributes('aria-label') === 'note-yellow')!
    expect(yellow.attributes('style')).toContain('background-color: rgb(252, 242, 146)')
  })
})
