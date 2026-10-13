<template>
  <div class="flex items-center gap-1.5" role="group" aria-label="Note color" data-testid="color-picker">
    <button
      v-for="token in NOTE_COLOR_NAMES"
      :key="token"
      type="button"
      data-testid="color-swatch"
      class="h-5 w-5 rounded-full border border-black/10 transition-transform hover:scale-110"
      :class="token === modelValue ? 'ring-2 ring-primary' : ''"
      :style="{ backgroundColor: NOTE_COLORS[token] }"
      :aria-label="token"
      :aria-pressed="token === modelValue"
      @mousedown.prevent
      @click="emit('update:modelValue', token)"
    />
  </div>
</template>

<script setup lang="ts">
import { NOTE_COLORS, NOTE_COLOR_NAMES } from '@/shared/constants/note-colors'

// Palette picker for the sticky-note color. The value exchanged with the
// parent is always the palette TOKEN (`note-yellow`, …) — never a hex —
// because the backend stores the token and Tailwind cannot see dynamic
// `bg-${color}` classes (AGENTS.md §2, note-colors.ts).
defineProps<{ modelValue: string }>()

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

// `@mousedown.prevent` on every swatch keeps focus inside the editor
// textarea: without it, picking a color would blur the textarea and trip
// PostItEditor's save-on-blur contract mid-pick.
</script>
