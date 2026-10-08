<script setup lang="ts">
import { ref } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { useRouter } from 'vue-router'
import { Button, Input } from '@ugogalliano/pm-design-system-vue'

import { registerSchema } from '@/shared/validation/schemas'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const { submitRegister } = useAuth()

const { handleSubmit, setErrors, setFieldError, isSubmitting } = useForm({
  validationSchema: toTypedSchema(registerSchema),
})

// Same form-level channel as LoginForm (policy lives in useAuth).
const formError = ref<string | null>(null)

const onSubmit = handleSubmit(async (values) => {
  formError.value = null
  const ok = await submitRegister(values, {
    setErrors,
    setFieldError,
    setFormMessage: (message) => {
      formError.value = message
    },
  })
  if (ok) {
    await router.push('/')
  }
})
</script>

<template>
  <!-- Card content only (AuthLayout owns page + card chrome). Mirrors the
       "02 Register" frame; form keeps the card's gap-5 rhythm. -->
  <form class="flex flex-col gap-5" novalidate @submit="onSubmit">
    <div class="flex flex-col gap-1.5">
      <h2 class="text-xl font-bold text-foreground">Create your account</h2>
      <p class="text-[13px] text-muted-foreground">
        Start organizing ideas with your team in seconds.
      </p>
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
        name="displayName"
        label="Display name"
        placeholder="How should we call you?"
        required
      />
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

    <Button type="submit" class="w-full" :loading="isSubmitting">Create account</Button>

    <p class="flex items-center justify-center gap-1 text-[13px] text-muted-foreground">
      Already have an account?
      <RouterLink to="/login" class="text-[13px] font-semibold text-foreground">Sign in</RouterLink>
    </p>
  </form>
</template>
