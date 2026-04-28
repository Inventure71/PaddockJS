export function normalizeCustomFields(customFields) {
  if (!customFields) return [];

  const entries = Array.isArray(customFields)
    ? customFields
    : Object.entries(customFields).map(([label, value]) => ({ label, value }));

  return entries
    .map((field) => ({
      label: String(field?.label ?? '').trim(),
      value: String(field?.value ?? '').trim(),
    }))
    .filter((field) => field.label && field.value);
}
