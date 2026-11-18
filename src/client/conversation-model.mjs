/** Groups store role IDs; stale group references belong to the ungrouped section. */
export function roleSections(roles = [], groups = []) {
  const assigned = new Set(groups.flatMap((g) => g.roleIds || []))
  return [
    ...groups.map((g) => ({ ...g, roles: roles.filter((r) => (g.roleIds || []).includes(r.id)) })),
    { id: null, name: '未分组', roles: roles.filter((r) => !assigned.has(r.id)) }
  ].filter((g) => g.roles.length)
}
