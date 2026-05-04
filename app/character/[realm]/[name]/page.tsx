// All character page content (profile + tabs) is rendered by the layout.
// This page exists to satisfy Next.js routing — it intentionally renders
// nothing of its own. Tab state lives in the URL hash and is handled
// client-side by CharacterTabsClient (mounted by the layout).
export default function CharacterPage() {
  return null;
}
