<template>
  <ErrorFallback v-if="globalError" :message="globalError.message" @retry="onRetry" />
  <RouterView v-else />
  <Toaster />
</template>

<script setup lang="ts">
import { onErrorCaptured, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { Toaster } from '@ugogalliano/pm-design-system-vue'

import ErrorFallback from '@/shared/components/ui/ErrorFallback/ErrorFallback.vue'
import {
  clearGlobalError,
  globalError,
  reportGlobalError,
} from '@/shared/composables/useGlobalError'

// Global error boundary (PLAN.FE.md §13 layer 4). Returning false from
// onErrorCaptured STOPS propagation, so the same error never also reaches
// app.config.errorHandler — exactly one report per error. The Toaster stays
// mounted beside the fallback: a rendered fallback must not swallow toasts.
// RETRY REMOUNT MECHANICS: showing the fallback already UNMOUNTS RouterView
// (it is the v-else branch), so clearing the error mounts the routed tree
// fresh — every child setup and query re-runs. A dynamic `:key` on the
// outlet is deliberately NOT used: a keyed child inside this root v-if/v-else
// fragment crashes Vue's block-patch on route navigation (observed in the
// boards-flow integration). The explicit replace() below additionally re-runs
// lazy route resolution; a duplicate-navigation rejection is harmless.
const route = useRoute()
const router = useRouter()

onErrorCaptured((err, _vm, info) => {
  reportGlobalError(err, info)
  return false
})

// SECURITY: a boundary error must never outlive the navigation that caused
// it — e.g. the session-terminated redirect to /login would otherwise hide
// the login page behind the fallback. This watcher reads fullPath OUTSIDE
// the render (App's render dependencies stay exactly `globalError` +
// RouterView, keeping the zero-re-render-on-navigation property), and
// clearGlobalError is idempotent: refs skip same-value sets, so navigating
// with NO active boundary error assigns null to a null ref and triggers
// nothing — no re-render churn.
watch(
  () => route.fullPath,
  () => clearGlobalError(),
)

function onRetry(): void {
  clearGlobalError()
  void router.replace(route.fullPath).catch(() => undefined)
}
</script>
