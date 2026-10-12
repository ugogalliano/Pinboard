<template>
  <!-- Card content only (AuthLayout owns page + card chrome). The form
       mirrors the card's gap-5 rhythm per the "01 Login" frame spec. -->
  <form class="flex flex-col gap-5" novalidate @submit="onSubmit">
    <div class="flex flex-col gap-1.5">
      <h2 class="text-xl font-bold text-foreground">Welcome back</h2>
      <p class="text-[13px] text-muted-foreground">Sign in to continue to your boards.</p>
    </div>

    <p
      v-if="formError"
      role="alert"
      class="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
    >
      {{ formError }}
    </p>

    <div class="flex flex-col gap-[14px]">
      <Input
        name="email"
        label="Email address"
        type="email"
        placeholder="you@example.com"
        required
      />
      <Input
        name="password"
        label="Password"
        type="password"
        placeholder="Enter your password"
        required
      />
    </div>

    <Button type="submit" class="w-full" :loading="isSubmitting">Sign in</Button>

    <p class="flex items-center justify-center gap-1 text-[13px] text-muted-foreground">
      Don't have an account?
      <RouterLink to="/register" class="text-[13px] font-semibold text-foreground"
        >Create one</RouterLink
      >
    </p>
  </form>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { useRoute, useRouter } from 'vue-router'
import { Button, Input } from '@ugogalliano/pm-design-system-vue'

import { loginSchema } from '@/shared/validation/schemas'
import { resolveRedirect, useAuth } from '../composables/useAuth'

const router = useRouter()
const route = useRoute()
const { submitLogin } = useAuth()

const { handleSubmit, setErrors, setFieldError, isSubmitting } = useForm({
  validationSchema: toTypedSchema(loginSchema),
})

// Form-level credential error — rendered, never toasted (policy lives in
// the useAuth composable; this component only renders and delegates).
const formError = ref<string | null>(null)

const onSubmit = handleSubmit(async (values) => {
  formError.value = null
  const ok = await submitLogin(values, {
    setErrors,
    setFieldError,
    setFormMessage: (message) => {
      formError.value = message
    },
  })
  if (ok) {
    await router.push(resolveRedirect(route.query.redirect))
  }
})
</script>
