// React Flow builds CSS selectors from node IDs while drawing connections.
// Domain IDs may be JSON tuples containing quotes. Escape only the projection;
// stored map positions, native identities and network references stay unchanged.
export const flowIdentity = id => `lm:${encodeURIComponent(id).replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16)}`)}`;
export const domainIdentity = id => id.startsWith('lm:') ? decodeURIComponent(id.slice(3)) : id;
