import { storeToRefs } from 'pinia'
import { useToast } from '@ugogalliano/pm-design-system-vue'

import {
  isApiError,
  isProfileLoadError,
  mapApiErrorToMessage,
  mapProblemErrors,
} from '@/shared/services/api'
import { useAuthStore } from '@/stores/authStore'
import type { LoginInput, RegisterInput } from '@/shared/validation/schemas'

/**
 * VeeValidate sinks + a form-level message channel the composable can write.
 * Method syntax (not property-function) deliberately: vee-validate's helpers
 * are typed with the schema's narrow field unions; methods are bivariant, so
 * the generic string signatures stay assignable without casts.
 */
export interface AuthFormSinks {
  setErrors(errors: Record<string, string>): void
  setFieldError(field: string, error: string): void
  setFormMessage(message: string | null): void
}

/**
 * Post-login redirect target, sanitized against open-redirect abuse (SEC
 * fix): only app-relative paths survive — absolute URLs and protocol-
 * relative "//host" forms fall back to "/".
 */
export function resolveRedirect(redirect: unknown): string {
  if (typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')) {
    return redirect
  }
  return '/'
}

/**
 * The auth feature's single error policy (REVIEW fix 2/3 — deduplicated
 * here so the forms never repeat it):
 * - ProfileLoadError (tokens issued, /me failed) → error toast; NEVER the
 *   "Invalid email or password" form message (REVIEW fix 1).
 * - 401 (login-step) → form-level "Invalid email or password" (PLAN.FE.md §5).
 * - 400 with an errors dict → mapped VeeValidate field errors.
 * - 409 → "already exists" on the email field (register context).
 * - anything else → error toast with the §4 mapped message.
 */
export function handleAuthError(err: unknown, sinks: AuthFormSinks): void {
  const { toast } = useToast()

  if (isProfileLoadError(err)) {
    toast({ variant: 'error', message: mapApiErrorToMessage(err.cause) })
    return
  }
  if (isApiError(err)) {
    if (err.status === 401) {
      sinks.setFormMessage('Invalid email or password')
      return
    }
    if (err.status === 400 && err.problem.errors) {
      sinks.setErrors(mapProblemErrors(err.problem))
      return
    }
    if (err.status === 409) {
      // Auth-form context: a conflict means the email is already registered.
      sinks.setFieldError('email', 'An account with this email already exists')
      return
    }
    toast({ variant: 'error', message: mapApiErrorToMessage(err) })
    return
  }
  toast({ variant: 'error', message: mapApiErrorToMessage(err) })
}

/**
 * Auth feature composable (Phase 3): store slices via storeToRefs + the
 * submission flows with the full error policy above. Components render and
 * delegate; they own navigation only.
 */
export function useAuth() {
  const authStore = useAuthStore()
  const { user, isAuthenticated, isLoading } = storeToRefs(authStore)

  /** Runs the store login; returns true when the caller may navigate. */
  async function submitLogin(values: LoginInput, sinks: AuthFormSinks): Promise<boolean> {
    try {
      await authStore.login(values)
      return true
    } catch (err) {
      handleAuthError(err, sinks)
      return false
    }
  }

  /** Runs register + auto-login; returns true when the caller may navigate. */
  async function submitRegister(values: RegisterInput, sinks: AuthFormSinks): Promise<boolean> {
    try {
      await authStore.register(values)
      return true
    } catch (err) {
      handleAuthError(err, sinks)
      return false
    }
  }

  return {
    user,
    isAuthenticated,
    isLoading,
    login: authStore.login,
    register: authStore.register,
    logout: authStore.logout,
    refreshUser: authStore.refreshUser,
    submitLogin,
    submitRegister,
  }
}
