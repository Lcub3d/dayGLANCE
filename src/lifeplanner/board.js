import { LIFE_TYPES, lifeDescendants } from './entities.js';
export const LANE_WIDTH = 320;
export const CARD_WIDTH = 224;
export const CARD_HEIGHT = 110;
export const ROW_GAP = 144;
export const laneIndex = type => type === null || type === 'untyped' ? -1 : type === 'task' ? 4 : LIFE_TYPES.indexOf(type);
export const lanePosition = (type, row = 0) => ({ x: laneIndex(type) * LANE_WIDTH + 48, y: 86 + row * ROW_GAP });
/** Classify using the card's centre in flow coordinates, not screen pixels. */
export function laneAt(position) {
  const x = position.x + CARD_WIDTH / 2;
  const index = Math.floor(x / LANE_WIDTH);
  return index === -1 ? null : index >= 0 && index < 4 ? LIFE_TYPES[index] : undefined;
}
export function alignedPosition(type, position) {
  return { x: lanePosition(type).x, y: Math.max(72, Math.min(100000, Math.round(position.y / 12) * 12)) };
}
export function boardLayout(nodes) {
  const used = new Map(), positions = new Map();
  for (const n of nodes) if (n.position) {
    positions.set(n.id, n.position);
    const key = laneIndex(n.type ?? n.kind); if (!used.has(key)) used.set(key, []); used.get(key).push(n.position.y);
  }
  for (const n of nodes) if (!positions.has(n.id)) {
    const type = n.type === null ? null : n.type || n.kind;
    const key = laneIndex(type); if (!used.has(key)) used.set(key, []);
    let row = 0;
    while (used.get(key).some(y => Math.abs(y - lanePosition(type, row).y) < CARD_HEIGHT + 18)) row++;
    const position = lanePosition(type, row); positions.set(n.id, position); used.get(key).push(position.y);
  }
  return positions;
}
export function focusedLifeGraph(graph, { root = null, query = '', showTasks = false } = {}) {
  const allowed = root ? lifeDescendants(graph.nodes, root) : null;
  const term = query.trim().toLocaleLowerCase();
  let nodes = graph.nodes.filter(n => (!allowed || allowed.has(n.id)) && (n.kind !== 'task' || showTasks)
    && (allowed || n.kind === 'task' || n.onCanvas || n.kind !== 'untyped'));
  if (term) {
    const keep = new Set(nodes.filter(n => n.title.toLocaleLowerCase().includes(term)).map(n => n.id));
    const queue = [...keep], visible = new Set(nodes.map(n => n.id));
    for (let i = 0; i < queue.length; i++) for (const p of nodes.find(n => n.id === queue[i])?.parentIds || []) {
      if (visible.has(p) && !keep.has(p)) { keep.add(p); queue.push(p); }
    }
    nodes = nodes.filter(n => keep.has(n.id));
  }
  const ids = new Set(nodes.map(n => n.id));
  return { nodes, edges: graph.edges.filter(e => ids.has(e.source) && ids.has(e.target)),
    externalEdges: graph.edges.filter(e => ids.has(e.source) !== ids.has(e.target)) };
}
