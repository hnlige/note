export function getUrgeSubmitWarning(input: { itemId?: string; content?: string }): string | null {
  if (!input.itemId) {
    return '请选择催办事项';
  }

  return null;
}
