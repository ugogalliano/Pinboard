import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastType = 'success' | 'error' | 'info'

export interface ToastMessage {
  id: string
  type: ToastType
  message: string
}

const TOAST_AUTO_DISMISS_MS = 3000

let toastCounter = 0

function nextToastId(): string {
  // jsdom/Node ≥19 ship crypto.randomUUID; keep a counter fallback.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `toast-${++toastCounter}`
}

// Transient UI state only — no server data, no persistence.
export const useUIStore = defineStore('ui', () => {
  const sidebarOpen = ref(true)
  const toasts = ref<ToastMessage[]>([])
  const activeModal = ref<string | null>(null)

  function toggleSidebar(): void {
    sidebarOpen.value = !sidebarOpen.value
  }

  /** Pushes a toast and auto-dismisses it after 3s. Returns its id. */
  function addToast(toast: Omit<ToastMessage, 'id'>): string {
    const id = nextToastId()
    toasts.value.push({ id, ...toast })
    setTimeout(() => removeToast(id), TOAST_AUTO_DISMISS_MS)
    return id
  }

  function removeToast(id: string): void {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function openModal(modal: string): void {
    activeModal.value = modal
  }

  function closeModal(): void {
    activeModal.value = null
  }

  return { sidebarOpen, toasts, activeModal, toggleSidebar, addToast, removeToast, openModal, closeModal }
})
