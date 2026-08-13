/**
 * Turn anything thrown into something worth showing a person.
 *
 * supabase-js throws PostgrestError, which is a plain object with a `message` - not an
 * Error - so `err instanceof Error ? err.message : String(err)` renders "[object Object]"
 * and every database message (car is full, only the driver can confirm) is lost.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message

  if (typeof err === 'object' && err !== null && 'message' in err) {
    const { message } = err as { message: unknown }
    if (typeof message === 'string' && message.length > 0) return message
  }

  return String(err)
}
