// Native parsing and artifact validation are CPU-heavy. Bound worker contention
// as the integration suite grows; retain Vitest's existing test timeouts.
export default { test: { maxWorkers: 4 } };
