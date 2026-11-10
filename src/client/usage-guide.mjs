// Only a seen flag is stored; workspace content never enters browser storage.
export const guideStorageKey = 'nexture-team:usage-guide:v1'
export function isNewWorkspace(snapshot) {
  return Array.isArray(snapshot?.roles) && Array.isArray(snapshot?.drafts) && Array.isArray(snapshot?.plans) && !snapshot.roles.some(role => !role.builtin) && snapshot.drafts.length === 0 && snapshot.plans.length === 0
}

export function createUsageGuide(storage = () => globalThis.localStorage) {
  let handled = false
  function markSeen() {
    handled = true
    try { storage()?.setItem(guideStorageKey, 'seen') } catch { /* Storage may be unavailable in the host. */ }
  }
  return {
    markSeen,
    takeFirstLook(snapshot, {enabled = true} = {}) {
      if (!enabled || handled || !(Array.isArray(snapshot?.roles) && Array.isArray(snapshot?.drafts) && Array.isArray(snapshot?.plans))) return false
      try { if (storage()?.getItem(guideStorageKey) === 'seen') { handled = true; return false } } catch {}
      const show = isNewWorkspace(snapshot)
      // Existing users are considered onboarded; clearing tasks must not trigger a tour.
      markSeen()
      return show
    },
  }
}
export const usageGuide = createUsageGuide()
