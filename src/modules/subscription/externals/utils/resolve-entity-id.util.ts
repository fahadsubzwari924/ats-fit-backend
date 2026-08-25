/**
 * Resolve Entity ID
 *
 * Creem's SDK types frequently express a relation as `{ id: string } | string`
 * (or, on webhook payloads that were never guaranteed to be "expanded",
 * `{ id: string } | string | undefined`) — the API may return either a fully
 * expanded object or just the bare id, depending on whether the relation was
 * expanded for that particular call/event. This narrows either shape down to
 * a plain id string.
 *
 * Two overloads keep callers honest: passing a value that is statically known
 * to be present (e.g. `SubscriptionEntity.product`) returns a non-optional
 * `string`; passing a value that may be absent (e.g. a webhook object's
 * optional `subscription` relation) returns `string | undefined` without
 * requiring a manual assertion at the call site.
 */
export function resolveEntityId(entity: { id: string } | string): string;
export function resolveEntityId(
  entity: { id: string } | string | undefined | null,
): string | undefined;
export function resolveEntityId(
  entity: { id: string } | string | undefined | null,
): string | undefined {
  if (entity === undefined || entity === null) {
    return undefined;
  }

  return typeof entity === 'string' ? entity : entity.id;
}
